import json
import os
import threading
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
_keepalive_thread = None


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
        _ensure_keepalive()
    return _pool


def _ensure_keepalive():
    global _keepalive_thread
    if _keepalive_thread is None:
        _keepalive_thread = threading.Thread(target=_ping_loop, daemon=True)
        _keepalive_thread.start()


def _ping_loop():
    """Mantiene el compute de Neon despierto y la conexión del pool caliente."""
    while True:
        time.sleep(30)
        try:
            conn = get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            finally:
                close_conn(conn)
        except Exception:
            pass


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
    import time as _t
    _t0 = _t.perf_counter()
    conn = get_conn()
    _t1 = _t.perf_counter()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            _t2 = _t.perf_counter()
            row = cur.fetchone()
            _t3 = _t.perf_counter()
        print(f"[db] getconn={(_t1-_t0)*1000:.0f}ms execute={(_t2-_t1)*1000:.0f}ms fetch={(_t3-_t2)*1000:.0f}ms", flush=True)
        return row
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