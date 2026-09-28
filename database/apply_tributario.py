"""Aplica la migración tributaria (database/schema_tributario.sql).

Es idempotente: puede re-ejecutarse sin efectos colaterales.
Uso:  python database/apply_tributario.py
"""
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")

sql_path = Path(__file__).resolve().parent / "schema_tributario.sql"
sql = sql_path.read_text(encoding="utf-8")

conn = psycopg2.connect(os.getenv("DATABASE_URL"))
conn.autocommit = False
cur = conn.cursor(cursor_factory=RealDictCursor)

try:
    cur.execute(sql)
    conn.commit()
    print("Migracion tributaria aplicada OK\n")
except Exception as e:
    conn.rollback()
    print("ERROR aplicando la migracion: %s" % e)
    sys.exit(1)

print("--- Verificacion ---")
cur.execute("""
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema='public' AND (
            (table_name='sales'  AND column_name IN ('fecha_emision','estado_fiscal'))
         OR (table_name IN ('uit_config','gastos_deducibles','pagos_cuenta_ir','ir_tramos'))
       )
     ORDER BY table_name, column_name
""")
for r in cur.fetchall():
    print("  %-22s %-22s %s" % (r["table_name"], r["column_name"], r["data_type"]))

print("\n--- Constraints de sales / purchases ---")
cur.execute("""
    SELECT conrelid::regclass AS tabla, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conname IN ('check_sales_totales','check_sales_estado_fiscal','check_sales_no_negativo',
                       'check_sales_invoice_type','check_purchases_totales','check_purchases_no_negativo',
                       'check_purchases_tipo_comprobante')
     ORDER BY 1, 2
""")
for r in cur.fetchall():
    print("  %-12s %-36s %s" % (r["tabla"], r["conname"], r["def"]))

print("\n--- Indices unicos ---")
cur.execute("""
    SELECT indexname FROM pg_indexes
     WHERE indexname IN ('uq_sales_comprobante','uq_purchases_comprobante','uq_pagos_cuenta_periodo')
     ORDER BY 1
""")
for r in cur.fetchall():
    print("  " + r["indexname"])

print("\n--- Valores por defecto de las ventas ---")
cur.execute("""
    SELECT estado_fiscal, COUNT(*)::int AS n, MIN(fecha_emision) AS min_fecha
      FROM sales GROUP BY 1 ORDER BY 1
""")
for r in cur.fetchall():
    print("  estado_fiscal=%-10s n=%-4s min_fecha=%s" % (r["estado_fiscal"], r["n"], r["min_fecha"]))

print("\n--- ventas que aun NO cuadran (debe ser 0) ---")
cur.execute("""
    SELECT id, invoice_type, invoice_number, subtotal, igv, total
      FROM sales WHERE ROUND(subtotal+igv,2) <> ROUND(total,2) ORDER BY id
""")
rows = cur.fetchall()
print("  %d registro(s)" % len(rows))
for r in rows:
    print("   ", dict(r))

print("\n--- UIT sembradas ---")
cur.execute("SELECT anio, valor_uit FROM uit_config ORDER BY anio")
for r in cur.fetchall():
    print("  %s -> %s" % (r["anio"], r["valor_uit"]))

print("\n--- Tramos del IR anual ---")
cur.execute("SELECT regimen, desde_uit, hasta_uit, tasa FROM ir_tramos ORDER BY regimen, desde_uit")
for r in cur.fetchall():
    print("  %-8s %8s -> %-8s  tasa=%s" % (r["regimen"], r["desde_uit"], r["hasta_uit"], r["tasa"]))

print("\n--- Settings tributarios ---")
cur.execute("""
    SELECT key, value FROM settings
     WHERE key LIKE 'igv%' OR key LIKE 'ir%' OR key LIKE 'purchase%'
     ORDER BY key
""")
for r in cur.fetchall():
    print("  %-26s = %s" % (r["key"], r["value"]))

cur.close()
conn.close()
print("\nListo.")
