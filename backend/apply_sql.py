"""Ejecuta un .sql contra la BD de Neon indicada en backend/.env.

Uso:  python apply_sql.py supabase_sync_queue.sql
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import psycopg2
from dotenv import load_dotenv

BACKEND = Path(__file__).parent
ROOT = BACKEND.parent
load_dotenv(BACKEND / ".env")

name = sys.argv[1] if len(sys.argv) > 1 else ""
path = ROOT / "database" / f"{name}.sql"
if not name or not path.exists():
    print(f"ERROR: no se encuentra {path}")
    sys.exit(1)

url = os.getenv("DATABASE_URL", "")
if not url:
    print("ERROR: DATABASE_URL no configurada")
    sys.exit(1)

try:
    conn = psycopg2.connect(url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(path.read_text(encoding="utf-8"))
        try:
            for row in cur.fetchall():
                print("  ->", row)
        except psycopg2.ProgrammingError:
            print("  (DDL sin resultados que devolver)")
    conn.close()
    print(f"OK: {name}.sql aplicado en Neon")
except Exception as e:
    print(f"ERROR aplicando {name}.sql: {e}")
    sys.exit(1)