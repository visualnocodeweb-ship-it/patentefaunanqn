import hmac
import logging
import os
import re
from dotenv import load_dotenv

load_dotenv()   # must be before db_utils import

from flask import Flask, jsonify, request, render_template, Response, session, redirect, url_for
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix
import db_utils
from db_utils import DBError
logging.basicConfig(level=logging.INFO)

# Fail fast before creating the Flask app
_AUTH_REQUIRED = ["SECRET_KEY", "LOGIN_USER", "LOGIN_PASSWORD"]
_auth_missing = [v for v in _AUTH_REQUIRED if not os.environ.get(v)]
if _auth_missing:
    raise RuntimeError(
        "Missing required auth environment variables: "
        + ", ".join(_auth_missing)
        + ". Set them in .env or the environment."
    )
del _auth_missing

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)  # trust nginx as single trusted proxy

app.secret_key = os.environ["SECRET_KEY"]
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Secure=True in production (HTTPS). Disabled when FLASK_DEBUG is a truthy value for local HTTP dev.
_debug_values = {"true", "1", "yes", "on"}
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_DEBUG", "").lower() not in _debug_values

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

_default_limit = os.environ.get("RATE_LIMIT_DEFAULT", "120 per minute")
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[_default_limit],
    storage_uri="memory://",  # For multi-worker: set REDIS_URL and use storage_uri=os.environ.get("REDIS_URL", "memory://")
)

@app.errorhandler(429)
def ratelimit_handler(e):
    response = jsonify({"error": "rate limit exceeded"})
    response.headers["Retry-After"] = e.description
    return response, 429

_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()] or ["*"]
CORS(
    app,
    origins=_cors_origins,
    methods=["GET", "HEAD"],
    allow_headers=["Content-Type", "Accept"],
)

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)

@app.after_request
def set_security_headers(response):
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    )
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

@app.route('/health')
@limiter.exempt
def health():
    """DB liveness probe. No rate limit — must be reachable by load balancers and uptime monitors."""
    try:
        ok = db_utils.ping_db()
    except RuntimeError:
        return jsonify({"status": "error", "detail": "DB pool exhausted"}), 503
    if ok:
        return jsonify({"status": "ok"}), 200
    return jsonify({"status": "error", "detail": "DB query failed"}), 503


@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("10 per minute", methods=["POST"])
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
            # Safety: only allow relative redirects (prevent open redirect)
            if not next_url.startswith('/') or next_url.startswith('//'):
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


@app.route('/')
def index():
    """Renders the main application page."""
    return render_template('index.html')

@app.route('/api/latest_images')
@limiter.limit("60 per minute")
def latest_images():
    """Fetches the latest images and associated plate detection data."""
    limit = request.args.get('limit', 5, type=int)
    limit = max(1, min(50, limit))
    try:
        images = db_utils.fetch_latest_images(limit=limit)
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    return jsonify(images)

@app.route('/api/recent_thumbnails')
def recent_thumbnails():
    """Fetches recent vehicle_picture thumbnails for the strip."""
    limit = request.args.get('limit', 8, type=int)
    limit = max(1, min(20, limit))
    try:
        thumbnails = db_utils.fetch_recent_thumbnails(limit=limit)
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    return jsonify(thumbnails)

@app.route('/api/filter_options')
def filter_options():
    """Returns unique sorted values for brand, color, and type dropdowns."""
    try:
        options = db_utils.fetch_filter_options()
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    return jsonify(options)

@app.route('/api/search_plate', methods=['GET'])
def search_plate():
    """
    Searches for images and associated plate detection data based on plate text.
    Expects 'plate' as a query parameter.
    """
    plate_text = request.args.get('plate')
    if not plate_text:
        return jsonify({"error": "Missing 'plate' query parameter"}), 400

    try:
        results = db_utils.search_by_plate_text(plate_text)
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    return jsonify(results)

@app.route('/api/images_by_datetime', methods=['GET'])
@limiter.limit("20 per minute")
def images_by_datetime():
    """
    Fetches images and associated plate detection data within a specified datetime range.
    Expects 'start_datetime' and 'end_datetime' as query parameters.
    Optionally accepts a 'limit' query parameter to restrict the number of results.
    """
    start_datetime = request.args.get('start_datetime')
    end_datetime = request.args.get('end_datetime')
    limit = request.args.get('limit', type=int) # Get optional limit parameter

    if not start_datetime or not end_datetime:
        return jsonify({"error": "Missing 'start_datetime' or 'end_datetime' query parameter"}), 400

    # Pass the limit if provided, otherwise use the default in db_utils
    try:
        if limit is not None:
            results = db_utils.fetch_images_by_datetime_range(start_datetime, end_datetime, limit=limit)
        else:
            results = db_utils.fetch_images_by_datetime_range(start_datetime, end_datetime)
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503

    return jsonify(results)

@app.route('/api/all_patents', methods=['GET'])
def all_patents():
    """
    Fetches all patent data with pagination and optional search.
    Expects 'page' and 'page_size' as query parameters.
    Optionally accepts 'search_term' for filtering by plate text.
    """
    page = request.args.get('page', 1, type=int)
    page_size = request.args.get('page_size', 10, type=int)
    search_term = request.args.get('search_term', None, type=str)
    brand_filter_raw = request.args.get('brand_filter', None, type=str)
    color_filter_raw = request.args.get('color_filter', None, type=str)
    type_filter_raw  = request.args.get('type_filter',  None, type=str)
    brand_filter = [v.strip() for v in brand_filter_raw.split(',') if v.strip()] if brand_filter_raw else None
    color_filter = [v.strip() for v in color_filter_raw.split(',') if v.strip()] if color_filter_raw else None
    type_filter  = [v.strip() for v in type_filter_raw.split(',')  if v.strip()] if type_filter_raw  else None
    start_date_filter = request.args.get('start_date_filter', None, type=str)
    end_date_filter = request.args.get('end_date_filter', None, type=str)
    min_confidence_filter = request.args.get('min_confidence_filter', None, type=float)

    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 10
    if page_size > 100:
        page_size = 100
    if min_confidence_filter is not None:
        min_confidence_filter = max(0.0, min(1.0, min_confidence_filter))

    try:
        patents, total_count = db_utils.fetch_all_patents_paginated(
            page, page_size, search_term,
            brand_filter=brand_filter,
            color_filter=color_filter,
            type_filter=type_filter,
            start_date_filter=start_date_filter,
            end_date_filter=end_date_filter,
            min_confidence_filter=min_confidence_filter
        )
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503

    return jsonify({
        'patents': patents,
        'total_count': total_count,
        'page': page,
        'page_size': page_size
    })

@app.route('/api/stats', methods=['GET'])
def stats():
    """Fetches aggregate statistics for detection events."""
    start_date = request.args.get('start_date', None, type=str)
    end_date = request.args.get('end_date', None, type=str)
    try:
        result = db_utils.fetch_stats(start_date_filter=start_date, end_date_filter=end_date)
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    if result:
        return jsonify(result)
    return jsonify({"error": "Failed to fetch stats"}), 500

_VALID_BROWSE_TYPES = {'vehicle_detection', 'vehicle_picture', 'plate'}

@app.route('/api/browse_images', methods=['GET'])
@limiter.limit("30 per minute")
def browse_images():
    """Keyset-paginated image metadata for the global carousel."""
    cursor_ts = request.args.get('cursor_ts', None, type=str)
    cursor_id = request.args.get('cursor_id', None, type=str)
    limit = request.args.get('limit', 3, type=int)
    limit = max(1, min(10, limit))
    direction = request.args.get('direction', 'forward', type=str)
    if direction not in ('forward', 'backward'):
        direction = 'forward'

    types_raw = request.args.get('types', 'vehicle_detection,vehicle_picture', type=str)
    types = [t.strip() for t in types_raw.split(',') if t.strip() in _VALID_BROWSE_TYPES]
    if not types:
        types = ['vehicle_detection', 'vehicle_picture']

    start_date = request.args.get('start_date', None, type=str)
    end_date = request.args.get('end_date', None, type=str)
    search_term = request.args.get('search_term', None, type=str)

    try:
        images = db_utils.fetch_browsable_images(
            cursor_ts=cursor_ts, cursor_id=cursor_id, limit=limit,
            direction=direction, types=types,
            start_date=start_date, end_date=end_date, search_term=search_term
        )
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503

    result = {'images': images}

    # Only include total_count on first request (no cursor)
    if not cursor_ts:
        try:
            result['total_count'] = db_utils.count_browsable_images(
                types, start_date=start_date, end_date=end_date, search_term=search_term
            )
        except (DBError, RuntimeError):
            return jsonify({"error": "Service temporarily unavailable"}), 503

    return jsonify(result)


@app.route('/api/browse_image/<image_id>', methods=['GET'])
@limiter.limit("30 per minute")
def browse_image(image_id):
    """Serves raw image bytes for a single image by ID."""
    if not _UUID_RE.match(image_id):
        return jsonify({"error": "Invalid image_id format"}), 400
    try:
        data = db_utils.fetch_browse_image_by_id(image_id)
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    if not data:
        return jsonify({"error": "Image not found"}), 404
    return Response(
        data['image_data'],
        mimetype='image/jpeg',
        headers={'Cache-Control': 'public, max-age=86400'}
    )


@app.route('/api/image/<event_id>', methods=['GET'])
def get_image(event_id):
    """
    Fetches image data (base64) and type for a given event_id.
    """
    if not _UUID_RE.match(event_id):
        return jsonify({"error": "Invalid event_id format"}), 400
    try:
        images = db_utils.fetch_image_by_event_id(event_id)
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    if images:
        return jsonify({"images": images})
    return jsonify({"error": "Image not found for this event_id"}), 404

if __name__ == '__main__':
    app.run(
        debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true',
        host='127.0.0.1'
    )
