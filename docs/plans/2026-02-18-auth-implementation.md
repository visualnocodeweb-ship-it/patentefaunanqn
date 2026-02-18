# Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Protect the entire app (all pages and all `/api/*` routes) behind a single-user username+password login using plain Flask sessions.

**Architecture:** Three new env vars (`SECRET_KEY`, `LOGIN_USER`, `LOGIN_PASSWORD`) validated at startup. A `before_request` hook gates every route except `/login`, `/logout`, `/health`, `/static/`. API requests get a 401 JSON response; page requests get a redirect to `/login`. Credentials are compared with `hmac.compare_digest` to prevent timing attacks.

**Tech Stack:** Flask (built-in `session`, `before_request`), `hmac` (stdlib), Jinja2 (existing), vanilla JS (existing).

---

## Task 1: Validate new env vars and configure session at startup

**Files:**
- Modify: `app.py` (top of file, near existing env/config setup)
- Modify: `.env.example`

**Step 1: Add env var validation in `app.py`**

After the `load_dotenv()` call and before any route definitions, add:

```python
import hmac

_AUTH_REQUIRED = ["SECRET_KEY", "LOGIN_USER", "LOGIN_PASSWORD"]
_auth_missing = [v for v in _AUTH_REQUIRED if not os.environ.get(v)]
if _auth_missing:
    raise RuntimeError(
        "Missing required auth environment variables: "
        + ", ".join(_auth_missing)
        + ". Set them in .env or the environment."
    )
del _auth_missing

app.secret_key = os.environ["SECRET_KEY"]
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Set to True in production (Render.com serves HTTPS); override with env var for local dev
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_DEBUG", "false").lower() != "true"
```

Place this block **after** `app = Flask(__name__)` and **before** the rate limiter / CORS setup.

**Step 2: Add new vars to `.env.example`**

Append to the "Auth" section (after the existing vars):

```
# Auth (required)
SECRET_KEY=<generate: python3 -c "import secrets; print(secrets.token_hex(32))">
LOGIN_USER=admin
LOGIN_PASSWORD=changeme
```

**Step 3: Verify the app still starts**

```bash
# With a .env that includes the new vars:
python app.py
# Expected: starts on http://127.0.0.1:5000 with no RuntimeError
```

**Step 4: Commit**

```bash
git add app.py .env.example
git commit -m "Add SECRET_KEY/LOGIN_USER/LOGIN_PASSWORD env vars and session config"
```

---

## Task 2: Add `before_request` auth hook

**Files:**
- Modify: `app.py` (after session config, before route definitions)

**Step 1: Add the hook**

```python
_PUBLIC_PATHS = {'/login', '/logout', '/health'}

@app.before_request
def require_login():
    """Block unauthenticated access to all routes except login, logout, health, and static assets."""
    if request.path in _PUBLIC_PATHS or request.path.startswith('/static/'):
        return  # allow through
    if session.get('authenticated'):
        return  # allow through
    # API callers get JSON 401; browsers get a redirect
    if request.path.startswith('/api/'):
        return jsonify({"error": "Unauthorized"}), 401
    return redirect(url_for('login', next=request.path))
```

Place this block directly after the session config (Task 1) and before any `@app.route` definitions.

**Step 2: Manually verify the hook fires**

Start the app (with `SECRET_KEY` etc. in `.env`):

```bash
python app.py
```

Then:
```bash
curl -s http://127.0.0.1:5000/api/stats
# Expected: {"error":"Unauthorized"} with HTTP 401

curl -s http://127.0.0.1:5000/
# Expected: HTTP 302 redirect to /login (Location header)

curl -s http://127.0.0.1:5000/health
# Expected: {"status":"ok"} with HTTP 200  (health still works)
```

**Step 3: Commit**

```bash
git add app.py
git commit -m "Add before_request auth gate: 401 for API, redirect for pages"
```

---

## Task 3: Add `/login` and `/logout` routes

**Files:**
- Modify: `app.py`

**Step 1: Add the routes**

Add these three routes **before** the existing `@app.route('/')` index route:

```python
@app.route('/login', methods=['GET', 'POST'])
@limiter.exempt
def login():
    """Login page. GET renders form; POST validates credentials."""
    if session.get('authenticated'):
        return redirect(url_for('index'))

    error = None
    if request.method == 'POST':
        submitted_user = request.form.get('username', '')
        submitted_pass = request.form.get('password', '')
        valid_user = hmac.compare_digest(submitted_user, os.environ['LOGIN_USER'])
        valid_pass = hmac.compare_digest(submitted_pass, os.environ['LOGIN_PASSWORD'])
        if valid_user and valid_pass:
            session.clear()
            session['authenticated'] = True
            next_url = request.form.get('next') or url_for('index')
            # Safety: only allow relative redirects
            if not next_url.startswith('/'):
                next_url = url_for('index')
            return redirect(next_url)
        error = 'Usuario o contraseña incorrectos.'

    next_url = request.args.get('next', '')
    return render_template('login.html', error=error, next=next_url)


@app.route('/logout')
def logout():
    """Clear session and redirect to login."""
    session.clear()
    return redirect(url_for('login'))
```

**Notes:**
- `@limiter.exempt` on `/login` so uptime monitors and retry loops can't hit the rate limit.
- `session.clear()` before setting `authenticated` prevents session fixation.
- The `next` redirect is validated to be relative to prevent open-redirect attacks.

**Step 2: Verify login/logout manually**

```bash
# Start app
python app.py

# Try bad credentials — expect re-render with error
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt \
  -d "username=wrong&password=wrong" -X POST http://127.0.0.1:5000/login
# Expected: HTML with "Usuario o contraseña incorrectos."

# Try good credentials — expect redirect to /
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt \
  -d "username=admin&password=changeme" -X POST http://127.0.0.1:5000/login -L -I
# Expected: final HTTP 200 at /

# Verify session cookie works on API
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt http://127.0.0.1:5000/api/stats
# Expected: JSON stats object (not 401)

# Logout — expect redirect to /login
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt http://127.0.0.1:5000/logout -I
# Expected: 302 to /login
```

**Step 3: Commit**

```bash
git add app.py
git commit -m "Add /login and /logout routes with session auth"
```

---

## Task 4: Create `templates/login.html`

**Files:**
- Create: `templates/login.html`

**Step 1: Create the template**

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Iniciar sesión — Patentes Fauna NQN</title>
    <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}">
    <style>
        /* Login-specific overrides */
        .login-card {
            max-width: 380px;
            margin: 80px auto;
            background: #fff;
            padding: 32px 28px;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        .login-card h1 {
            font-size: 1.3rem;
            margin-bottom: 24px;
        }
        .login-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 16px;
        }
        .login-field label {
            font-size: 13px;
            color: #555;
        }
        .login-field input {
            padding: 8px 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            width: 100%;
            box-sizing: border-box;
        }
        .login-field input:focus-visible {
            outline: 2px solid #0056b3;
            outline-offset: 2px;
        }
        .login-btn {
            width: 100%;
            padding: 10px;
            background-color: #007bff;
            color: #fff;
            border: none;
            border-radius: 4px;
            font-size: 15px;
            cursor: pointer;
            touch-action: manipulation;
            margin-top: 8px;
        }
        .login-btn:hover {
            background-color: #0056b3;
        }
        .login-error {
            color: #c00;
            font-size: 13px;
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <h1>Gestión de Imágenes LPR</h1>

        {% if error %}
        <p class="login-error" role="alert">{{ error }}</p>
        {% endif %}

        <form method="post" action="{{ url_for('login') }}">
            <input type="hidden" name="next" value="{{ next }}">

            <div class="login-field">
                <label for="username">Usuario</label>
                <input
                    type="text"
                    id="username"
                    name="username"
                    autocomplete="username"
                    required
                    autofocus>
            </div>

            <div class="login-field">
                <label for="password">Contraseña</label>
                <input
                    type="password"
                    id="password"
                    name="password"
                    autocomplete="current-password"
                    required>
            </div>

            <button type="submit" class="login-btn">Ingresar</button>
        </form>
    </div>
</body>
</html>
```

**Step 2: Verify in browser**

Start the app and navigate to `http://127.0.0.1:5000/` in a browser (private window to avoid cached session). Expected:
- Redirected to `/login`
- Login card renders centered on gray background with blue heading
- Submitting wrong credentials shows red error text
- Submitting correct credentials redirects to main page

**Step 3: Commit**

```bash
git add templates/login.html
git commit -m "Add login.html template matching existing app style"
```

---

## Task 5: Handle 401 in frontend JS

**Files:**
- Modify: `static/script.js`

**Step 1: Add a helper at the top of the `DOMContentLoaded` callback**

Immediately after the opening `document.addEventListener('DOMContentLoaded', () => {` line and its DOM refs block, add:

```javascript
// Redirect to login page on 401 (session expired or not authenticated)
function handle401(response) {
    if (response.status === 401) {
        window.location.href = '/login';
        return true;
    }
    return false;
}
```

**Step 2: Add the check in each `fetch` call**

Find every place a fetch response is received and add a 401 check before processing the data. There are **6 fetch call sites** to update:

1. **`fetchPatentsTableData`** (around line 244):
```javascript
const response = await fetch(url, { signal: tableAbort.signal });
if (handle401(response)) return;   // ← add this line
const data = await response.json();
```

2. **`fetchStats`** (around line 269):
```javascript
const response = await fetch(url, { signal: statsAbort.signal });
if (handle401(response)) return;   // ← add this line
const data = await response.json();
```

3. **`fetchLatestThumbnails`** (around line 322):
```javascript
const response = await fetch('/api/recent_thumbnails?limit=7');
if (handle401(response)) return;   // ← add this line
```

4. **`openModalForEvent`** (around line 513):
```javascript
const response = await fetch(`/api/image/${eventId}`);
if (handle401(response)) return;   // ← add this line
```

5. **`browseLoadPage`** (around line 603):
```javascript
const resp = await fetch('/api/browse_images?' + params, { signal: browseAbort.signal });
if (handle401(resp)) return;   // ← add this line
```

6. **`browsePrefetch`** (around line 682):
```javascript
const resp = await fetch('/api/browse_images?' + params);
if (handle401(resp)) return;   // ← add this line
```

**Step 3: Verify manually**

With the app running and logged in, open the browser devtools console and simulate a 401:

```javascript
// Paste in devtools console:
handle401({ status: 401 });
// Expected: page navigates to /login
```

Also verify normal operation is unaffected by loading the main page after logging in.

**Step 4: Commit**

```bash
git add static/script.js
git commit -m "Handle 401 in JS: redirect to /login on session expiry"
```

---

## Task 6: Add logout link to main UI

**Files:**
- Modify: `templates/index.html`

**Step 1: Add a logout link**

Find the `<main class="container" id="main-content">` opening tag and the `<h1>` heading. Add a logout link as a small top-right element:

```html
<main class="container" id="main-content">
    <div style="text-align:right; margin-bottom: 4px;">
        <a href="{{ url_for('logout') }}" style="font-size:12px; color:#555; text-decoration:none;">Cerrar sesión</a>
    </div>
    <h1>Gestión de Imágenes LPR</h1>
```

This is intentionally minimal (inline style) to avoid adding CSS for a single element.

**Step 2: Verify in browser**

Navigate to the main page after logging in. Expected:
- "Cerrar sesión" link appears top-right
- Clicking it redirects to `/login` and the session is cleared
- Navigating back to `/` redirects back to `/login`

**Step 3: Commit**

```bash
git add templates/index.html
git commit -m "Add logout link to main page header"
```

---

## Final verification checklist

After all tasks are committed, verify end-to-end:

```bash
# 1. Start fresh
python app.py

# 2. API without session → 401
curl -s http://127.0.0.1:5000/api/stats | python3 -m json.tool
# Expected: {"error": "Unauthorized"}

# 3. /health still works (no auth)
curl -s http://127.0.0.1:5000/health
# Expected: {"status": "ok"}

# 4. Login with wrong credentials
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  -d "username=bad&password=bad" -X POST http://127.0.0.1:5000/login | grep -o 'incorrectos'
# Expected: incorrectos

# 5. Login with correct credentials
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  -d "username=admin&password=changeme" -X POST http://127.0.0.1:5000/login -I
# Expected: 302 to /

# 6. API with valid session cookie → 200
curl -s -c /tmp/c.txt -b /tmp/c.txt http://127.0.0.1:5000/api/stats | python3 -m json.tool
# Expected: full stats JSON

# 7. Logout clears session
curl -s -c /tmp/c.txt -b /tmp/c.txt http://127.0.0.1:5000/logout -I
curl -s -c /tmp/c.txt -b /tmp/c.txt http://127.0.0.1:5000/api/stats
# Expected: 302 to /login, then {"error": "Unauthorized"}
```
