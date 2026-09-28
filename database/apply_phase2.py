"""
Aplica las migraciones de la Fase 2 (Pagos + Cuentas por Pagar).
Idempotente: se puede ejecutar varias veces sin errores.

Uso:
    cd database
    python apply_phase2.py
"""
import os, sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

_BACKEND_ENV = Path(__file__).resolve().parent.parent / "backend" / ".env"
if _BACKEND_ENV.exists():
    load_dotenv(_BACKEND_ENV)
else:
    load_dotenv()

url = os.getenv("DATABASE_URL", "")
if not url:
    print("ERROR: DATABASE_URL no configurada en backend/.env")
    sys.exit(1)

sql_path = Path(__file__).resolve().parent / "schema_phase2.sql"
sql = sql_path.read_text(encoding="utf-8")

conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()
try:
    cur.execute(sql)
    print("Schema Fase 2 aplicado OK")
    cur.execute(
        "SELECT purchase_id, codigo_compra, moneda, total, total_pagado, saldo "
        "FROM v_accounts_payable ORDER BY purchase_id DESC LIMIT 10"
    )
    for r in cur.fetchall():
        print("  ", r)
finally:
    cur.close()
    conn.close()