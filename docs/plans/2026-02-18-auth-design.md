# Auth Design — Single-User Login

**Date:** 2026-02-18
**Branch:** audit-remediation
**Scope:** Protect every route behind a username + password login.

---

## Requirements

- Single user (admin only).
- Entire app protected: all pages and all `/api/*` endpoints.
- Credentials stored in env vars (no user table).
- `/health`, `/login`, `/logout`, and `/static/*` are public.

---

## Approach

Plain `flask.session` (signed cookie). No extra library.

**New env vars:**

| Var | Example | Notes |
|-----|---------|-------|
| `SECRET_KEY` | `<random 32-byte hex>` | Signs session cookies |
| `LOGIN_USER` | `admin` | Username |
| `LOGIN_PASSWORD` | `changeme` | Password |

---

## Backend (`app.py`)

### New routes

| Method | Path | Behaviour |
|--------|------|-----------|
| `GET` | `/login` | Render `login.html`; redirect to `/` if already authenticated |
| `POST` | `/login` | Compare credentials with `hmac.compare_digest`; set `session['authenticated'] = True`; redirect to `next` or `/` |
| `GET` | `/logout` | Clear session; redirect to `/login` |

### `before_request` hook

Runs before every request. Exempt paths: `/login`, `/logout`, `/health`, `/static/`.

- If `session.get('authenticated')` is truthy → allow.
- Else if `request.path.startswith('/api/')` → return `jsonify({"error": "Unauthorized"})`, 401.
- Else → `redirect(url_for('login', next=request.path))`.

### Session config

```python
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = True   # set False for local HTTP dev
```

`SECRET_KEY` loaded from env; raise `RuntimeError` at startup if missing (same pattern as DB vars).

---

## Frontend

### `templates/login.html`

Standalone HTML page (no SPA). Matches existing style:
- White card on gray background, blue heading.
- Username + password fields, "Ingresar" submit button.
- Error message area for bad credentials.
- Form POSTs to `/login`; `next` passed as hidden field.

### `static/script.js`

Add a global 401 handler in the `fetchJSON` / fetch utility so that if any API call returns 401 the browser redirects to `/login` instead of displaying broken data.

---

## Env vars to add to `.env.example`

```
# Auth (required for production)
SECRET_KEY=<generate with: python3 -c "import secrets; print(secrets.token_hex(32))">
LOGIN_USER=admin
LOGIN_PASSWORD=changeme
```

---

## Out of scope

- Multi-user, roles, or registration.
- CSRF tokens (SameSite=Lax cookie + same-origin form is sufficient here).
- Rate limiting on `/login` (the global limiter already covers it).
- "Remember me" / persistent sessions.
