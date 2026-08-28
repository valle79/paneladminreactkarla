"""Respaldo completo del estado actual de Neon a archivos JSON.
Ejecutar ANTES de cualquier migración destructiva.
Uso: python backup_neon.py  ->  Genera backups/neon_backup_<timestamp>/*.json
"""
import os
import sys
from pathlib import Path
from datetime import datetime
import json

from dotenv import load_dotenv
load_dotenv(r"C:\Users\luisv\OneDrive\Escritorio\proyectoKarla\paneladminreactkarla\backend\.env")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import db

TABLES = ["advisors","machine_products","spare_parts","services","clients","clients_ruc","sales","sale_items","promotions"]

def main():
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    outdir = Path(__file__).resolve().parent / "backups" / f"neon_backup_{ts}"
    outdir.mkdir(parents=True, exist_ok=True)

    summary = {}
    conn = db.get_conn()
    try:
        with conn.cursor() as cur:
            # Restablecer identidad para conservar IDs y secuencias
            for t in TABLES:
                cur.execute(f'SELECT * FROM public.{t} ORDER BY 1')
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
                # serializar tipos no-JSON (decimal, date, etc.)
                with open(outdir / f"{t}.json", "w", encoding="utf-8") as f:
                    json.dump(rows, f, ensure_ascii=False, indent=2, default=str)
                summary[t] = len(rows)
                print(f"  {t}: {len(rows)}")

            # Respaldar secuencias
            seqs = {}
            cur.execute("SELECT sequencename AS sequence_name, last_value FROM pg_sequences WHERE schemaname='public' AND sequencename LIKE '%_id_seq'")
            for r in cur.fetchall():
                seqs[r["sequence_name"]] = r["last_value"]
            with open(outdir / "sequences.json", "w", encoding="utf-8") as f:
                json.dump(seqs, f, indent=2, default=str)
    finally:
        db.close_conn(conn)

    with open(outdir / "_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\nRespaldo completado en: {outdir}")
    print("Resumen:", summary)

if __name__ == "__main__":
    main()
