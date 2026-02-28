"""Tests for the invalid_plates_only filter on /api/all_patents."""
import sys


def test_all_patents_invalid_plates_only_returns_200(auth_client):
    sys.modules["db_utils"].fetch_all_patents_paginated.return_value = ([], 0)
    r = auth_client.get("/api/all_patents?invalid_plates_only=true")
    assert r.status_code == 200
    data = r.get_json()
    assert "patents" in data
    assert "total_count" in data


def test_all_patents_invalid_plates_only_false_returns_200(auth_client):
    sys.modules["db_utils"].fetch_all_patents_paginated.return_value = ([], 0)
    r = auth_client.get("/api/all_patents?invalid_plates_only=false")
    assert r.status_code == 200


def test_all_patents_no_invalid_filter_returns_200(auth_client):
    sys.modules["db_utils"].fetch_all_patents_paginated.return_value = ([], 0)
    r = auth_client.get("/api/all_patents")
    assert r.status_code == 200
