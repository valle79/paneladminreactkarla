"""Ejecuta database/neon_schema.sql contra la BD configurada en backend/.env"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

url = os.getenv("DATABASE_URL", "")
if not url:
    print("ERROR: DATABASE_URL no configurada")
    sys.exit(1)

schema = Path(__file__).parent.parent / "database" / "neon_schema.sql"
if not schema.exists():
    print(f"ERROR: no se encuentra {schema}")
    sys.exit(1)

try:
    conn = psycopg2.connect(url)
    conn.autocommit = True
    print("Conectado a Neon OK")
    with conn.cursor() as cur:
        cur.execute(schema.read_text(encoding="utf-8"))
        tables = cur.fetchall()
        print("Tablas verificadas:")
        for t in tables:
            print(f"  - {t[0]}")
        cur.execute(
            "SELECT (SELECT COUNT(*) FROM advisors) a, (SELECT COUNT(*) FROM machine_products) p, "
            "(SELECT COUNT(*) FROM spare_parts) r, (SELECT COUNT(*) FROM services) s, "
            "(SELECT COUNT(*) FROM clients) c, (SELECT COUNT(*) FROM clients_ruc) cr, "
            "(SELECT COUNT(*) FROM promotions) pr"
        )
        counts = cur.fetchone()
        print(
            "Seed: asesores=%s productos=%s repuestos=%s servicios=%s clientes=%s empresas=%s promociones=%s"
            % tuple(counts)
        )
    conn.close()
    print("Script ejecutado con éxito")
except Exception as e:
    print(f"ERROR ejecutando el schema: {e}")
    sys.exit(1)