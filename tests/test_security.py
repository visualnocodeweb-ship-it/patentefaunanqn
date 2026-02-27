"""Guardrails: security headers and open-redirect prevention must survive deploys."""

REQUIRED_HEADERS = [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
]


def test_security_headers_on_public_route(client):
    r = client.get("/login")
    for header in REQUIRED_HEADERS:
        assert header in r.headers, f"Missing security header: {header}"


def test_security_headers_on_authenticated_api(auth_client):
    r = auth_client.get("/api/filter_options")
    for header in REQUIRED_HEADERS:
        assert header in r.headers, f"Missing security header: {header}"


def test_csp_blocks_inline_scripts(client):
    r = client.get("/login")
    csp = r.headers.get("Content-Security-Policy", "")
    assert "script-src 'self'" in csp


def test_open_redirect_via_next_blocked(client):
    r = client.post(
        "/login",
        data={"username": "testuser", "password": "testpass", "next": "//evil.com/steal"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    location = r.headers["Location"]
    assert "evil.com" not in location


def test_open_redirect_http_scheme_blocked(client):
    r = client.post(
        "/login",
        data={"username": "testuser", "password": "testpass", "next": "http://evil.com"},
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert "evil.com" not in r.headers["Location"]
