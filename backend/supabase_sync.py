"""
Sincronización de catálogo NEON -> SUPABASE (escrituras duales).

Cada alta, edición o baja que se hace en este panel (FastAPI + Neon) se
replica en la base de datos de Supabase, que es la que consume el otro panel
admin (sin backend) y la web pública.

DISEÑO
------
* Neon es la fuente de verdad. La escritura en Neon se hace SIEMPR primero y
  su resultado no depende de Supabase: si Supabase falla, la operación del
  panel sigue siendo correcta.
* Lo que falla se guarda en la tabla `supabase_sync_queue` de Neon y un hilo de
  fondo lo reintenta hasta que salga. Así no se pierde nada en silencio.
* Se replica el estado COMPLETO de la fila leída de Neon, no solo los campos
  del payload. Con eso un único camino sirve para alta, edición, borrado
  lógico y restauración, y Supabase queda como una copia exacta de Neon.

REQUISITOS
----------
* backend/.env con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
* Funciones RPC instaladas en Supabase (database/supabase_sync_functions.sql).

Variables de entorno opcionales:
    SUPABASE_SYNC_ENABLED     1/0        apaga la réplica por completo (por defecto 1)
    SUPABASE_SYNC_TIMEOUT     segundos   timeout por petición (por defecto 15)
    SUPABASE_SYNC_INTERVAL    segundos   cada cuánto reintenta la cola (por defecto 60)
"""

import json
import os
import threading
import time
import uuid
from datetime import date, datetime
from decimal import Decimal

import httpx
from dotenv import load_dotenv

load_dotenv()

import db

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

CATALOG_TABLES = ("advisors", "machine_products", "spare_parts", "promotions")

# Función RPC en Supabase que replica cada tabla.
RPC_BY_TABLE = {
    "advisors": "sync_advisors",
    "machine_products": "sync_machine_products",
    "spare_parts": "sync_spare_parts",
    "promotions": "sync_promotions",
}

DELETE_RPC = "sync_delete_promotion"
STATUS_RPC = "sync_status"

# Columnas que Neon guarda como TEXT con JSON dentro y Supabase como jsonb.
JSON_COLS = {
    "advisors": ("specialties",),
    "machine_products": ("specifications", "features", "dimensions"),
    "spare_parts": ("specifications", "features"),
    "promotions": (),
}

MAX_ATTEMPTS = 3

# Evita saturar Supabase si el panel recibe muchas escrituras seguidas.
_slots = threading.BoundedSemaphore(4)

_worker = None
_worker_lock = threading.Lock()
_queue_available = None


def _cfg():
    """Lee la configuración en el momento de usarla (así se pueden rotar sin reiniciar)."""
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    return url, key


def _enabled() -> bool:
    return os.getenv("SUPABASE_SYNC_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def _timeout() -> float:
    try:
        return float(os.getenv("SUPABASE_SYNC_TIMEOUT", "15"))
    except ValueError:
        return 15.0


def _interval() -> float:
    try:
        return float(os.getenv("SUPABASE_SYNC_INTERVAL", "60"))
    except ValueError:
        return 60.0


def is_configured() -> bool:
    url, key = _cfg()
    return bool(url and key)


# ---------------------------------------------------------------------------
# Conversión de tipos Neon -> Supabase
# ---------------------------------------------------------------------------

def _json_safe(value):
    """Convierte tipos de psycopg2/Neon a algo que viaja bien dentro de un JSON."""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, Decimal):
        # numeric 8000.00 -> "8000.00" (Supabase lo castea según el tipo de columna)
        return format(value, "f")
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (dict, list)):
        return value
    return str(value)


def build_payload(table: str, row: dict) -> dict:
    """Prepara una fila de Neon para mandarla a la función RPC de Supabase."""
    payload = {k: _json_safe(v) for k, v in dict(row).items()}
    for col in JSON_COLS.get(table, ()):
        if col in payload:
            # db.to_json devuelve el string tal cual si ya lo es, o serializa dict/list.
            payload[col] = db.to_json(payload[col])
    return payload


# ---------------------------------------------------------------------------
# Llamadas HTTP a Supabase (PostgREST)
# ---------------------------------------------------------------------------

def _headers(key: str) -> dict:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _call(rpc_name: str, body: dict) -> None:
    """Invoca una función RPC en Supabase, con reintentos cortos ante fallos de red."""
    url, key = _cfg()
    if not url or not key:
        raise RuntimeError("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en backend/.env")

    endpoint = f"{url}/rest/v1/rpc/{rpc_name}"
    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with _slots:
                resp = httpx.post(endpoint, headers=_headers(key), json=body, timeout=_timeout())
            if resp.status_code >= 400:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:400]}")
            return
        except Exception as exc:
            last_error = exc
            if attempt < MAX_ATTEMPTS:
                time.sleep(0.4 * attempt)
    raise RuntimeError(f"{rpc_name}: {last_error}")


# ---------------------------------------------------------------------------
# Cola de reintentos (Neon)
# ---------------------------------------------------------------------------

def _has_queue() -> bool:
    """Comprueba una sola vez si existe la tabla de cola en Neon."""
    global _queue_available
    if _queue_available is None:
        try:
            db.fetch_one("SELECT 1 AS ok FROM public.supabase_sync_queue LIMIT 1")
            _queue_available = True
        except Exception:
            _queue_available = False
    return _queue_available


def _enqueue(table: str, row_id: str, op: str, payload: dict, error: str) -> None:
    """Guarda el cambio pendiente para reintentarlo más tarde."""
    try:
        if not _has_queue():
            return
        db.execute(
            """
            INSERT INTO public.supabase_sync_queue
                (table_name, row_id, op, payload, attempts, last_error)
            VALUES (%s, %s, %s, %s, 1, %s)
            """,
            [table, row_id, op, json.dumps(payload, ensure_ascii=False), str(error)[:2000]],
            returning=None,
        )
    except Exception:
        print(f"[sync-supabase] no se pudo encolar {table}/{row_id}: {error}", flush=True)


def pending_count() -> int:
    try:
        if not _has_queue():
            return 0
        row = db.fetch_one(
            "SELECT COUNT(*)::int AS n FROM public.supabase_sync_queue WHERE resolved_at IS NULL"
        )
        return row["n"] if row else 0
    except Exception:
        return 0


def drain_queue(limit: int = 50) -> dict:
    """Reintenta los cambios pendientes. Devuelve un resumen."""
    result = {"ok": 0, "failed": 0, "skipped": 0}
    if not _has_queue():
        result["skipped"] = 1
        return result

    rows = db.fetch_all(
        """
        SELECT id, table_name, row_id, op, payload
        FROM public.supabase_sync_queue
        WHERE resolved_at IS NULL
        ORDER BY id
        LIMIT %s
        """,
        [limit],
    )

    for row in rows:
        rpc = DELETE_RPC if row["op"] == "delete" else RPC_BY_TABLE.get(row["table_name"])
        if not rpc:
            db.execute(
                "UPDATE public.supabase_sync_queue SET resolved_at = now(), last_error = %s WHERE id = %s",
                [f"tabla desconocida: {row['table_name']}", row["id"]],
                returning=None,
            )
            result["skipped"] += 1
            continue

        body = {"p_id": row["row_id"]}
        if row["op"] != "delete":
            body["p_row"] = row["payload"] or {}

        try:
            _call(rpc, body)
        except Exception as exc:
            db.execute(
                """
                UPDATE public.supabase_sync_queue
                SET attempts = attempts + 1, last_error = %s
                WHERE id = %s
                """,
                [str(exc)[:2000], row["id"]],
                returning=None,
            )
            result["failed"] += 1
            continue

        db.execute(
            "UPDATE public.supabase_sync_queue SET resolved_at = now(), last_error = NULL WHERE id = %s",
            [row["id"]],
            returning=None,
        )
        result["ok"] += 1

    return result


def _worker_loop() -> None:
    while True:
        time.sleep(_interval())
        try:
            if pending_count():
                drain_queue()
        except Exception:
            pass


def ensure_worker() -> None:
    """Arranca el hilo de reintentos (una sola vez, y solo si todo está listo)."""
    global _worker
    if not _enabled() or not is_configured():
        return
    with _worker_lock:
        if _worker is not None and _worker.is_alive():
            return
        _worker = threading.Thread(target=_worker_loop, daemon=True, name="supabase-sync")
        _worker.start()


# ---------------------------------------------------------------------------
# API pública: se llama desde main.py después de cada escritura en Neon
# ---------------------------------------------------------------------------

def sync_row(table: str, row, item_id=None) -> bool:
    """
    Replica en Supabase el estado actual de una fila de Neon.

    `row` es el dict devuelto por el INSERT/UPDATE de Neon (o None si solo se
    conoce el id, p. ej. para volver a encolar un cambio pendiente).
    Nunca lanza excepciones: si algo falla, encola el cambio y devuelve False.
    """
    if not _enabled() or table not in RPC_BY_TABLE:
        return True

    payload = build_payload(table, row) if row else {}
    row_id = None
    if row:
        row_id = row.get("id")
    elif item_id is not None:
        row_id = item_id
    if row_id is None:
        return True

    row_id = str(row_id)
    try:
        _call(RPC_BY_TABLE[table], {"p_id": row_id, "p_row": payload})
        return True
    except Exception as exc:
        print(f"[sync-supabase] fallo al replicar {table}/{row_id}: {exc}", flush=True)
        _enqueue(table, row_id, "upsert", payload, str(exc))
        return False


def delete_row(table: str, row_id) -> bool:
    """
    Replica una eliminación. Solo promotions se borra de forma física; en los
    otros catálogos el borrado es lógico y ya viaja dentro de sync_row().
    """
    if not _enabled() or table != "promotions":
        return True
    if row_id is None:
        return True

    row_id = str(row_id)
    try:
        _call(DELETE_RPC, {"p_id": row_id})
        return True
    except Exception as exc:
        print(f"[sync-supabase] fallo al borrar promotions/{row_id}: {exc}", flush=True)
        _enqueue(table, row_id, "delete", {}, str(exc))
        return False


# ---------------------------------------------------------------------------
# Diagnóstico
# ---------------------------------------------------------------------------

def status() -> dict:
    """Compara Neon contra Supabase. Pensado para GET /api/sync/status.

    Compara por id, no por cantidad de filas: Supabase puede tener registros
    propios que nunca pasaron por este panel (por ejemplo, promociones creadas
    desde el panel de Supabase) y eso NO es un error de sincronización.
    Lo que sí importa es que ninguna fila de Neon esté sin replicar.
    """
    url, key = _cfg()
    out = {
        "enabled": _enabled(),
        "configured": bool(url and key),
        "supabase_url": url or None,
        "supabase_reachable": False,
        "rpc_installed": False,
        "pending": pending_count(),
        "tables": [],
    }
    if not _enabled() or not url or not key:
        return out

    supa = {}
    try:
        with _slots:
            resp = httpx.post(
                f"{url}/rest/v1/rpc/{STATUS_RPC}",
                headers=_headers(key),
                json={},
                timeout=_timeout(),
            )
        if resp.status_code < 400:
            out["supabase_reachable"] = True
            supa = resp.json() or {}
            out["rpc_installed"] = bool(supa.get("version"))
        else:
            out["error"] = f"sync_status HTTP {resp.status_code}: {resp.text[:300]}"
            return out
    except Exception as exc:
        out["error"] = f"no se pudo contactar Supabase: {exc}"
        return out

    for table in CATALOG_TABLES:
        entry = {"table": table, "neon_rows": None, "supabase_rows": supa.get(table)}
        try:
            neon_ids = {str(r["id"]) for r in db.fetch_all(f"SELECT id::text AS id FROM public.{table}") if r}
            entry["neon_rows"] = len(neon_ids)
        except Exception:
            neon_ids = None
        try:
            with _slots:
                resp = httpx.get(
                    f"{url}/rest/v1/{table}",
                    headers={**_headers(key), "Prefer": "count=exact"},
                    params={"select": "id"},
                    timeout=_timeout(),
                )
            resp.raise_for_status()
            supa_ids = {str(r["id"]) for r in resp.json()}
        except Exception as exc:
            out["tables"].append(entry)
            entry["error"] = str(exc)[:200]
            continue

        if neon_ids is None:
            out["tables"].append(entry)
            continue

        faltan = sorted(neon_ids - supa_ids)
        entry["faltan_en_supabase"] = len(faltan)
        entry["solo_en_supabase"] = len(supa_ids - neon_ids)
        entry["in_sync"] = not faltan
        if faltan:
            entry["ids_faltantes"] = faltan[:20]
        out["tables"].append(entry)

    out["in_sync"] = all(t.get("in_sync") for t in out["tables"]) if out["tables"] else None
    return out


def resync_table(table: str) -> dict:
    """Vuelve a enviar todas las filas de una tabla de Neon a Supabase."""
    if table not in RPC_BY_TABLE:
        raise ValueError(f"tabla no sincronizable: {table}")
    rows = db.fetch_all(f"SELECT * FROM public.{table} ORDER BY id")
    sent = failed = 0
    for row in rows:
        row = dict(row)
        if sync_row(table, row):
            sent += 1
        else:
            failed += 1
    return {"table": table, "sent": sent, "failed": failed, "total": len(rows)}


# ---------------------------------------------------------------------------
# Utilidad de línea de comandos
#   python supabase_sync.py --check      estado de la sincronización
#   python supabase_sync.py --resync     reenvía todo el catálogo
#   python supabase_sync.py --drain      reintenta la cola pendiente
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    if not is_configured():
        print("ERROR: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en backend/.env")
        sys.exit(1)

    args = set(sys.argv[1:])
    if "--check" in args or not args:
        print(json.dumps(status(), ensure_ascii=False, indent=2))
    elif "--drain" in args:
        print(json.dumps(drain_queue(), ensure_ascii=False, indent=2))
    elif "--resync" in args:
        only = None
        for table in args:
            if table in CATALOG_TABLES:
                only = table
        tables = [only] if only else list(CATALOG_TABLES)
        for table in tables:
            print(json.dumps(resync_table(table), ensure_ascii=False))
    else:
        print("Uso: python supabase_sync.py [--check | --resync [tabla] | --drain]")