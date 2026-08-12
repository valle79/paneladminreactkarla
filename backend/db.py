import json
import os
import time

import psycopg2
import psycopg2.extras
import psycopg2.pool
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://user:password@localhost:5432/neondb?sslmode=require",
)

_pool = None
_last_failed_at: float = 0.0


def _build_pool():
    """Crea el pool de conexiones (se conecta una sola vez a Neon y se reutilizan)."""
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=12,
            dsn=DATABASE_URL,
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
    return _pool


def get_conn():
    """Devuelve una conexión del pool (reutilizada)."""
    global _last_failed_at
    try:
        return _build_pool().getconn()
    except Exception:
        if time.time() - _last_failed_at > 30:
            _last_failed_at = time.time()
        raise


def close_conn(conn):
    """Devuelve la conexión al pool (la descarta si está rota)."""
    if conn:
        try:
            _pool.putconn(conn)
        except Exception:
            try:
                conn.close()
            except Exception:
                pass


def fetch_all(sql, params=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        close_conn(conn)


def fetch_one(sql, params=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()
    finally:
        close_conn(conn)


def execute(sql, params=None, returning="id"):
    """Ejecuta INSERT/UPDATE/DELETE. Si hay RETURNING, devuelve la primera fila."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone() if returning else None
        conn.commit()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        close_conn(conn)


# ---------------------------------------------------------------------------
# JSON(TEXT) vs text[] helpers
# ---------------------------------------------------------------------------

def to_json(value):
    """Serializa dicts/lists a string JSON para columnas de texto."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def from_json(value):
    """Parsea columnas de texto que contienen JSON."""
    if value is None or isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return value