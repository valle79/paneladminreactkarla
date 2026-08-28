import os, sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

load_dotenv(r"C:\Users\luisv\OneDrive\Escritorio\proyectoKarla\paneladminreactkarla\backend\.env")
sql_path = Path(__file__).resolve().parent / "schema_updates.sql"
sql = sql_path.read_text(encoding="utf-8")

conn = psycopg2.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()
cur.execute(sql)
conn.commit()
print("Schema updates applied OK")

# Verify
cur.execute("""
  SELECT table_name, column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('machine_products','spare_parts')
    AND column_name IN ('stock','status')
  ORDER BY table_name, column_name
""")
for r in cur.fetchall():
    print(" ", r)
cur.close()
conn.close()
