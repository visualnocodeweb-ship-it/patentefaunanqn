"""Guardrails: input validation must reject malformed requests."""


def test_image_invalid_uuid_returns_400(auth_client):
    r = auth_client.get("/api/image/not-a-uuid")
    assert r.status_code == 400


def test_image_valid_uuid_not_found_returns_404(auth_client):
    r = auth_client.get("/api/image/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_browse_image_invalid_uuid_returns_400(auth_client):
    r = auth_client.get("/api/browse_image/definitely-not-a-uuid")
    assert r.status_code == 400


def test_search_plate_missing_param_returns_400(auth_client):
    r = auth_client.get("/api/search_plate")
    assert r.status_code == 400


def test_images_by_datetime_missing_params_returns_400(auth_client):
    r = auth_client.get("/api/images_by_datetime")
    assert r.status_code == 400


def test_health_returns_json(client):
    r = client.get("/health")
    assert r.content_type.startswith("application/json")
    data = r.get_json()
    assert "status" in data
