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


def test_patch_event_invalid_uuid_returns_400(auth_client):
    r = auth_client.patch("/api/event/not-a-uuid", json={"plate_text": "ABC123"})
    assert r.status_code == 400


def test_patch_event_empty_plate_returns_400(auth_client):
    r = auth_client.patch(
        "/api/event/00000000-0000-0000-0000-000000000000",
        json={"plate_text": ""}
    )
    assert r.status_code == 400


def test_patch_event_missing_plate_returns_400(auth_client):
    r = auth_client.patch(
        "/api/event/00000000-0000-0000-0000-000000000000",
        json={"vehicle_brand": "Toyota"}
    )
    assert r.status_code == 400


def test_patch_event_not_found_returns_404(auth_client):
    import sys
    sys.modules["db_utils"].update_detection_event.return_value = False
    r = auth_client.patch(
        "/api/event/00000000-0000-0000-0000-000000000000",
        json={"plate_text": "ABC123"}
    )
    assert r.status_code == 404


def test_patch_event_success_returns_ok(auth_client):
    import sys
    sys.modules["db_utils"].update_detection_event.return_value = True
    r = auth_client.patch(
        "/api/event/00000000-0000-0000-0000-000000000000",
        json={"plate_text": "ABC123", "vehicle_brand": "Toyota"}
    )
    assert r.status_code == 200
    assert r.get_json() == {"ok": True}
