import os
import sys
from unittest.mock import MagicMock

import pytest

# Required env vars must be set before app import (checked at module level)
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("LOGIN_USER", "testuser")
os.environ.setdefault("LOGIN_PASSWORD", "testpass")
os.environ.setdefault("FLASK_DEBUG", "true")  # disables Secure cookie for HTTP test client

# Mock db_utils before app import — no real DB needed in CI
_db = MagicMock()
_db.DBError = Exception
_db.ping_db.return_value = True
_db.fetch_latest_images.return_value = []
_db.fetch_recent_thumbnails.return_value = []
_db.fetch_filter_options.return_value = {}
_db.search_by_plate_text.return_value = []
_db.fetch_images_by_datetime_range.return_value = []
_db.fetch_all_patents_paginated.return_value = ([], 0)
_db.fetch_stats.return_value = {"total": 0}
_db.fetch_browsable_images.return_value = []
_db.count_browsable_images.return_value = 0
_db.fetch_browse_image_by_id.return_value = None
_db.fetch_image_by_event_id.return_value = None
sys.modules["db_utils"] = _db

import app as _app_module  # noqa: E402


@pytest.fixture(scope="session")
def app():
    _app_module.app.config["TESTING"] = True
    return _app_module.app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth_client(client):
    """Test client with an active session."""
    with client.session_transaction() as sess:
        sess["authenticated"] = True
    return client
