import multiprocessing
import os

# Worker configuration
worker_class = "gthread"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
threads = int(os.environ.get("WEB_THREADS", "4"))

# Timeouts
timeout = 60
graceful_timeout = 30
keepalive = 5

# Logging
accesslog = "-"   # stdout
errorlog = "-"    # stderr
loglevel = "info"

# Bind (Render.com sets PORT; fall back to 10000)
bind = f"0.0.0.0:{os.environ.get('PORT', '10000')}"


def post_fork(server, worker):
    """
    Re-initialise the DB connection pool in each worker after fork.

    gunicorn uses a pre-fork model: the master process forks workers AFTER
    importing the app. psycopg2 connections are NOT fork-safe, so we must
    close the inherited pool and create a fresh one per worker.
    """
    import db_utils
    import psycopg2.pool

    # Close connections inherited from the master process
    try:
        db_utils._pool.closeall()
    except Exception:
        pass

    # Re-create the pool fresh for this worker
    db_utils._pool = psycopg2.pool.ThreadedConnectionPool(
        minconn=int(os.environ.get("DB_POOL_MIN", "2")),
        maxconn=int(os.environ.get("DB_POOL_MAX", "10")),
        host=db_utils.DB_HOST,
        database=db_utils.DB_NAME,
        user=db_utils.DB_USER,
        password=db_utils.DB_PASSWORD,
        connect_timeout=10,
        options="-c statement_timeout=30000",
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=5,
        keepalives_count=5,
    )
