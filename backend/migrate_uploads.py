"""Migra los archivos de backend/uploads/ a Cloudinary y actualiza la BD.

Uso:
    python migrate_uploads.py

Requiere en .env (o variables de entorno):
    DATABASE_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

El script es idempotente: solo migra registros cuya URL aún apunte a /uploads/.
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import db
import storage

UPLOAD_DIR = Path(__file__).parent / "uploads"

LOCAL_URL_RE = re.compile(r"^/uploads/(.+)$")

TABLES = [
    ("advisors", "image_url"),
    ("machine_products", "image_url"),
    ("machine_products", "pdf_url"),
    ("spare_parts", "image_url"),
    ("spare_parts", "pdf_url"),
    ("promotions", "image_url"),
]


def _rows_with_uploads(table: str, col: str):
    return db.fetch_all(
        f"SELECT id, {col} AS url FROM {table} WHERE {col} LIKE '/uploads/%'"
    )


def _upload_local(name: str):
    path = UPLOAD_DIR / name
    if not path.exists():
        return None
    return storage.upload_bytes(path.read_bytes(), name)


def main() -> None:
    if not storage.is_configured():
        print("ERROR: Cloudinary no está configurado (faltan variables CLOUDINARY_*)")
        sys.exit(1)

    total = migrated = missing = skipped = 0
    for table, col in TABLES:
        rows = _rows_with_uploads(table, col)
        if not rows:
            continue
        print(f"\n[{table}.{col}] {len(rows)} registro(s):")
        for r in rows:
            total += 1
            m = LOCAL_URL_RE.match(r["url"])
            if not m:
                skipped += 1
                print(f"  ! id={r['id']}: URL no local, se omite")
                continue
            name = m.group(1)
            new_url = _upload_local(name)
            if not new_url:
                missing += 1
                print(f"  - id={r['id']}: archivo local no encontrado -> {name}")
                continue
            db.execute(
                f"UPDATE {table} SET {col} = %s WHERE id = %s",
                (new_url, r["id"]),
                returning=None,
            )
            migrated += 1
            print(f"  + id={r['id']}: {name} -> {new_url[:90]}...")

    print(f"\nResumen: {migrated} migrados, {missing} sin archivo local, "
          f"{skipped} omitidos (de {total} evaluados)")


if __name__ == "__main__":
    main()