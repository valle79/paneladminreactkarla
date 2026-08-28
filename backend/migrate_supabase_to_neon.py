"""
MIGRACIÓN DE SUPABASE → NEON (PostgreSQL/Neon) — IQUEÑO SAC

Migra las 4 tablas que utiliza la web pública desde Supabase:
    advisors, machine_products, spare_parts, promotions
Conservando los IDs originales y re-subiendo las imágenes/PDF/videos de
Supabase Storage a Cloudinary (reutilizando storage.py del backend).

Características:
  * Reutilizable  ·  Idempotente  ·  Muestra progreso y conteos  ·  Reporta fallos
  * No borra datos de Supabase
  * Guarda registros cuyo URL no pudo migrar para revisión

Variables de entorno (backend/.env):
    SUPABASE_URL            (ej: https://xxx.supabase.co)
    SUPABASE_ANON_KEY       (clave anon/servicio de Supabase)
    DATABASE_URL            (cadena de Neon)
    CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET

USO:
    python migrate_supabase_to_neon.py --dry-run     # solo informa, no escribe
    python migrate_supabase_to_neon.py --force-clear # vacía las 4 tablas y reinserta
    python migrate_supabase_to_neon.py               # upsert (idempotente, sin borrar)

Con --force-clear se vacían (TRUNCATE RESTART IDENTITY) las 4 tablas de Neon y se
insertan los datos de Supabase conservando IDs, como pidió el equipo (Neon
contenía datos de catálogo desactualizados sin imágenes/precios reales).
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import unquote

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

import db
import storage

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY", "")
REST_URL = f"{SUPABASE_URL}/rest/v1"

# Tablas a migrar y sus columnas "URL" (archivos en Supabase Storage)
TABLES = [
    {"table": "advisors",        "url_cols": ["image_url"]},
    {"table": "machine_products","url_cols": ["image_url", "pdf_url"]},
    {"table": "spare_parts",     "url_cols": ["image_url", "pdf_url"]},
    {"table": "promotions",      "url_cols": ["image_url"]},
]


# ----------------------------------------------------------------------------
# Lectura desde Supabase (PostgREST)
# ----------------------------------------------------------------------------
def fetch_supabase_table(table: str) -> tuple[list, list]:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
    }
    url = f"{REST_URL}/{table}?select=*"
    with httpx.Client(headers=headers, timeout=60) as client:
        resp = client.get(url)
        if resp.status_code >= 400:
            raise RuntimeError(f"Supabase {table}: HTTP {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        if not isinstance(data, list):
            raise RuntimeError(f"Supabase {table}: respuesta inesperada")
        errors = []
        return data, errors


# ----------------------------------------------------------------------------
# Migración de archivos (Supabase Storage -> Cloudinary)
# ----------------------------------------------------------------------------
def migrate_file_url(old_url: str, dry_run: bool, failures: list, report: dict) -> str:
    """Si old_url apunta a Storage de Supabase, lo baja y lo sube a Cloudinary.
    Devuelve la nueva URL. Si ya es de Cloudinary/externa, lo deja igual."""
    if not old_url:
        return old_url
    marker = "/storage/v1/object/public/"
    if storage.is_configured() and marker in old_url:
        idx = old_url.find(marker)
        object_path = unquote(old_url[idx + len(marker):])
        filename = Path(object_path).name or "file"
        try:
            with httpx.Client(timeout=90) as client:
                r = client.get(old_url)
                if r.status_code != 200:
                    failures.append((old_url, f"descarga HTTP {r.status_code}"))
                    report["failed"] += 1
                    return old_url
            if dry_run:
                report["would_migrate"] += 1
                return old_url
            new_url = storage.upload_bytes(r.content, filename)
            report["migrated"] += 1
            return new_url
        except Exception as e:
            failures.append((old_url, str(e)))
            report["failed"] += 1
            return old_url
    return old_url


# ----------------------------------------------------------------------------
# Transformaciones por tabla
# ----------------------------------------------------------------------------
def transform_row(table: str, row: dict, dry_run: bool, failures: list, report: dict) -> dict:
    """Ajusta tipos y migra URLs antes de insertar."""
    out = dict(row)

    # Migrar URLs de archivos (Storage -> Cloudinary)
    for col in TABLES_CFG[table]["url_cols"]:
        if out.get(col):
            out[col] = migrate_file_url(out[col], dry_run, failures, report)

    # Conversión de tipos
    if table == "spare_parts" and "price" in out:
        try:
            out["price"] = float(out["price"]) if out["price"] not in (None, "") else 0.0
        except (TypeError, ValueError):
            out["price"] = 0.0
    if table == "machine_products" and "price" in out:
        try:
            out["price"] = float(out["price"]) if out["price"] not in (None, "") else 0.0
        except (TypeError, ValueError):
            out["price"] = 0.0

    # machine_products: price NOT NULL -> si vino null, 0
    if "price" in out and out["price"] is None:
        out["price"] = 0

    for c in ("specifications", "features", "dimensions", "specialties"):
        if c in out and out[c] is not None and not isinstance(out[c], str):
            out[c] = json.dumps(out[c], ensure_ascii=False)

    # promotions usa UUID id y columnas created_at/updated_at; todo bien.
    return out


# ----------------------------------------------------------------------------
# Escritura en Neon
# ----------------------------------------------------------------------------
def clear_table(table: str):
    db.execute(f"TRUNCATE TABLE public.{table} RESTART IDENTITY CASCADE", returning=None)


def insert_or_upsert(table: str, columns: list, rows: list):
    """Inserta conservando IDs. Usa ON CONFLICT (id) para idempotencia."""
    if not rows:
        return 0
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            for row in rows:
                cols = [c for c in columns if c in row]
                vals = [row[c] for c in cols]
                upd_cols = [c for c in cols if c != "id"]
                update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in upd_cols) if upd_cols else "id = EXCLUDED.id"
                placeholders = ", ".join(["%s"] * len(vals))
                upsert_sql = (
                    f"INSERT INTO public.{table} ({', '.join(cols)}) "
                    f"VALUES ({placeholders}) "
                    f"ON CONFLICT (id) DO UPDATE SET {update_set}"
                )
                cur.execute(upsert_sql, vals)
        conn.commit()
        return len(rows)
    except Exception:
        conn.rollback()
        raise
    finally:
        db.close_conn(conn)


# ----------------------------------------------------------------------------
# Validación
# ----------------------------------------------------------------------------
def validate_counts() -> dict:
    out = {}
    for cfg in TABLES:
        t = cfg["table"]
        n = db.fetch_one(f"SELECT COUNT(*)::int AS n FROM public.{t}")["n"]
        out[t] = n
    return out


# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------
def main():
    global TABLES_CFG
    TABLES_CFG = {c["table"]: c for c in TABLES}

    ap = argparse.ArgumentParser(description="Migración Supabase -> Neon")
    ap.add_argument("--dry-run", action="store_true", help="Solo informa, no escribe")
    ap.add_argument("--force-clear", action="store_true", help="Vacía las 4 tablas antes de insertar")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: faltan SUPABASE_URL / SUPABASE_ANON_KEY en backend/.env")
        sys.exit(1)
    if not storage.is_configured():
        print("AVISO: Cloudinary no configurado; los URLs de Storage se conservarán "
              "(no se migrarán archivos a la nube).")

    summary = {}
    all_failures = []

    for cfg in TABLES:
        t = cfg["table"]
        print(f"\n=== Migrando {t} ===")
        report = {"migrated": 0, "would_migrate": 0, "failed": 0}
        try:
            rows, errs = fetch_supabase_table(t)
        except Exception as e:
            print(f"  ERROR leyendo Supabase: {e}")
            summary[t] = {"source": "ERROR", "migrated": 0, "failed_rows": None}
            continue

        print(f"  Origen (Supabase): {len(rows)} registros")

        if args.force_clear and not args.dry_run:
            clear_table(t)
            print("  Neon: tabla vaciada (TRUNCATE RESTART IDENTITY CASCADE)")

        transformed = []
        for r in rows:
            transformed.append(transform_row(t, r, args.dry_run, all_failures, report))

        columns = set()
        for r in transformed:
            columns.update(r.keys())

        migrated = 0
        if args.dry_run:
            migrated = len(transformed)
            print(f"  [dry-run] Se insertarían {len(transformed)} registros; "
                  f"archivos a migrar: {report['would_migrate']}")
        else:
            if transformed:
                migrated = insert_or_upsert(t, list(columns), transformed)
            print(f"  Neon: {migrated} registros insertados/actualizados")

        summary[t] = {
            "source": len(rows),
            "migrated": migrated,
            "archivos_migrados": report["migrated"],
            "archivos_fallidos": report["failed"],
            "failed_rows": len(all_failures),
        }
        if all_failures:
            with open(BACKEND_DIR / f"migracion_fallidos_{t}.json", "w", encoding="utf-8") as f:
                json.dump(all_failures, f, ensure_ascii=False, indent=2)
        all_failures.clear()

    # Validación final
    print("\n=== VALIDACIÓN (conteo Neon) ===")
    counts = validate_counts()
    for t, n in counts.items():
        src = summary.get(t, {}).get("source", "?")
        ok = "OK" if src == "?" or src == n else "DIFERENCIA"
        print(f"  {t}: Neon={n} Supabase={src} -> {ok}")

    print("\n=== RESUMEN ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("\nMigración finalizada. Los archivos de Supabase NO fueron eliminados.")


if __name__ == "__main__":
    main()
