"""
Guardrail: _validate_date() must return a parsed datetime object so that
psycopg2 sends a typed parameter to PostgreSQL — not a string — preserving
the time component in WHERE clauses.

Regression for: hour-level filters silently ignored because _validate_date()
returned the raw string instead of the parsed datetime object.
"""
import datetime
import sys
import types

import pytest


@pytest.fixture(scope="module")
def db_utils_real():
    """Import real db_utils with DB env vars stubbed out."""
    import os
    os.environ.setdefault("DB_HOST", "localhost")
    os.environ.setdefault("DB_NAME", "test")
    os.environ.setdefault("DB_USER", "test")
    os.environ.setdefault("DB_PASSWORD", "test")

    # Remove the mock set by conftest so we load the real module
    real_name = "db_utils"
    saved = sys.modules.pop(real_name, None)

    # Stub psycopg2 to avoid needing a real Postgres install
    from unittest.mock import MagicMock
    pg_mock = types.ModuleType("psycopg2")
    pg_mock.pool = types.ModuleType("psycopg2.pool")
    pg_mock.pool.ThreadedConnectionPool = MagicMock(return_value=MagicMock())
    pg_mock.extras = types.ModuleType("psycopg2.extras")
    sys.modules["psycopg2"] = pg_mock
    sys.modules["psycopg2.pool"] = pg_mock.pool
    sys.modules["psycopg2.extras"] = pg_mock.extras

    import importlib
    mod = importlib.import_module(real_name)

    yield mod

    # Restore mock for subsequent test modules
    sys.modules.pop(real_name, None)
    if saved is not None:
        sys.modules[real_name] = saved


def test_validate_date_returns_datetime_object(db_utils_real):
    result = db_utils_real._validate_date("2026-02-27T14:30:00")
    assert isinstance(result, datetime.datetime), (
        "_validate_date() must return a datetime object, not a string. "
        "Returning a string causes PostgreSQL to ignore the time component."
    )


def test_validate_date_preserves_time_component(db_utils_real):
    result = db_utils_real._validate_date("2026-02-27T14:30:00")
    assert result.hour == 14
    assert result.minute == 30


def test_validate_date_accepts_date_only(db_utils_real):
    result = db_utils_real._validate_date("2026-02-27")
    assert isinstance(result, datetime.datetime)


def test_validate_date_rejects_invalid(db_utils_real):
    assert db_utils_real._validate_date("not-a-date") is None
    assert db_utils_real._validate_date("") is None
    assert db_utils_real._validate_date(None) is None
