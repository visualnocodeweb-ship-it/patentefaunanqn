"""Guardrails: authentication wall must hold across deploys."""


def test_root_redirects_unauthenticated(client):
    r = client.get("/")
    assert r.status_code == 302
    assert "/login" in r.headers["Location"]


def test_api_returns_401_without_auth(client):
    protected = [
        "/api/latest_images",
        "/api/recent_thumbnails",
        "/api/filter_options",
        "/api/search_plate?plate=ABC123",
        "/api/all_patents",
        "/api/stats",
        "/api/browse_images",
    ]
    for path in protected:
        r = client.get(path)
        assert r.status_code == 401, f"Expected 401 for {path}, got {r.status_code}"


def test_health_is_public(client):
    r = client.get("/health")
    assert r.status_code == 200


def test_login_page_is_public(client):
    r = client.get("/login")
    assert r.status_code == 200


def test_login_wrong_credentials(client):
    r = client.post("/login", data={"username": "wrong", "password": "wrong"})
    assert r.status_code == 200
    assert b"incorrectos" in r.data
    # Must not create a session
    with client.session_transaction() as sess:
        assert not sess.get("authenticated")


def test_login_correct_credentials(client):
    r = client.post(
        "/login",
        data={"username": "testuser", "password": "testpass"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    with client.session_transaction() as sess:
        assert sess.get("authenticated") is True


def test_authenticated_reaches_index(auth_client):
    r = auth_client.get("/")
    assert r.status_code == 200


def test_logout_clears_session(auth_client):
    auth_client.get("/logout")
    r = auth_client.get("/")
    assert r.status_code == 302
    assert "/login" in r.headers["Location"]
