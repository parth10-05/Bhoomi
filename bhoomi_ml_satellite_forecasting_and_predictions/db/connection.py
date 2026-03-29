# BHOOMI — connection.py
"""
PostgreSQL connection pool (DigitalOcean managed DB, SSL required).
"""

import logging
from contextlib import contextmanager
from urllib.parse import urlparse

import psycopg2
from psycopg2 import pool as pg_pool

from config.settings import DATABASE_URL

log = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# Connection pool
# ────────────────────────────────────────────────────────────────────────────

_pool: pg_pool.ThreadedConnectionPool | None = None


def _init_pool() -> pg_pool.ThreadedConnectionPool | None:
    """Parse DATABASE_URL and create a threaded connection pool."""
    if not DATABASE_URL:
        log.warning("DATABASE_URL is None — DB pool not created")
        return None

    try:
        parsed = urlparse(DATABASE_URL)
        _p = pg_pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            host=parsed.hostname,
            port=parsed.port or 25060,
            dbname=parsed.path.lstrip("/"),
            user=parsed.username,
            password=parsed.password,
            sslmode="require",
        )
        log.info("DB pool created -> %s:%s/%s", parsed.hostname, parsed.port, parsed.path.lstrip("/"))
        return _p
    except Exception as exc:
        log.warning("DB pool creation failed: %s", exc)
        return None


_pool = _init_pool()


# ────────────────────────────────────────────────────────────────────────────
# Context manager
# ────────────────────────────────────────────────────────────────────────────

@contextmanager
def get_connection():
    """Yield a connection from the pool; return it on exit."""
    if _pool is None:
        raise RuntimeError("Database pool is not initialised")
    conn = _pool.getconn()
    try:
        yield conn
    finally:
        _pool.putconn(conn)


# ────────────────────────────────────────────────────────────────────────────
# Query helpers
# ────────────────────────────────────────────────────────────────────────────

def execute_query(sql: str, params=None, fetch: bool = True):
    """Execute a single SQL statement. Return rows for SELECTs, rowcount otherwise."""
    if _pool is None:
        raise RuntimeError("Database pool is not initialised")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            if fetch:
                columns = [desc[0] for desc in cur.description]
                return [dict(zip(columns, row)) for row in cur.fetchall()]
            conn.commit()
            return cur.rowcount


def execute_many(sql: str, params_list: list) -> int:
    """Execute a statement for many parameter sets. Return total rowcount."""
    if _pool is None:
        raise RuntimeError("Database pool is not initialised")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params_list)
            conn.commit()
            return cur.rowcount


# ────────────────────────────────────────────────────────────────────────────
# Health check
# ────────────────────────────────────────────────────────────────────────────

def test_connection() -> bool:
    """Return True if a simple SELECT 1 succeeds."""
    try:
        result = execute_query("SELECT 1 AS ok")
        return bool(result)
    except Exception as exc:
        log.warning("DB health check failed: %s", exc)
        return False
