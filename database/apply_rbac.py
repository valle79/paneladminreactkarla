"""
Aplica el esquema RBAC (users, roles, permissions, user_roles, role_permissions, audit_logs).
Idempotente: se puede ejecutar varias veces sin errores.

Uso:
    cd database
    python apply_rbac.py
"""
import os, sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

_BACKEND_ENV = Path(__file__).resolve().parent.parent / "backend" / ".env"
if _BACKEND_ENV.exists():
    load_dotenv(_BACKEND_ENV)
else:
    load_dotenv()

sql_path = Path(__file__).resolve().parent / "schema_rbac.sql"
sql = sql_path.read_text(encoding="utf-8")

conn = psycopg2.connect(os.getenv("DATABASE_URL"))
conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute(sql)
print("RBAC schema applied OK")

cur.execute(
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_schema='public' AND table_name IN "
    "('users','roles','permissions','user_roles','role_permissions','audit_logs') ORDER BY table_name"
)
for r in cur.fetchall():
    print("  ", r["table_name"])
cur.close()
conn.close()
