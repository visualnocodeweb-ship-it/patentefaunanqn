# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Flask web application for managing LPR (License Plate Recognition) images from traffic cameras in Neuquén. Connects to a remote PostgreSQL database on Render.com to display detection events, vehicle images, and plate data through a web UI.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run the Flask web server (port 5000, debug mode)
python app.py

# Run standalone scripts
python extract_images.py      # Download images from DB to imagenes_extraidas/
python automate_download.py   # Incremental download using timestamp tracking
```

No test suite or linter is configured.

## Architecture

**Database layer** (`db_utils.py`): All PostgreSQL access via `psycopg2`. Hardcoded credentials connect to a Render.com hosted DB. Three tables are queried:
- `detection_events` — plate text, vehicle brand/color/type, confidence, timestamps
- `event_images` — binary image data (base64-encoded for API responses)
- `plate_detections` — additional plate detection data joined via `event_id`

Vehicle brand typos are normalized via `VEHICLE_BRAND_NORMALIZATION_MAP`.

**Flask API** (`app.py`): Serves a single-page app and JSON API endpoints:
- `GET /api/latest_images` — most recent detection images
- `GET /api/search_plate?plate=` — search by plate text (ILIKE partial match)
- `GET /api/images_by_datetime?start_datetime=&end_datetime=` — date range filter
- `GET /api/all_patents?page=&page_size=&search_term=` — paginated patent table with filters (brand, type, date range)
- `GET /api/image/<event_id>` — single image by event ID

**Frontend** (`templates/index.html`, `static/script.js`, `static/style.css`): Vanilla JS single-page interface with:
- Card gallery views for latest images and search results
- Paginated data table with multi-filter support (plate, brand, type, date range)
- Image modal triggered from table rows

**Utility scripts**:
- `extract_images.py` — one-shot batch download of images from DB to disk
- `automate_download.py` — incremental download tracking last processed timestamp in `last_processed_timestamp.txt`
- `main.py` — scratch/debug script (not part of the app)

## Known Issues

- DB credentials are hardcoded in `db_utils.py`, `extract_images.py`, and `main.py` (should use environment variables)
- `requirements.txt` has encoding issues (null bytes between characters) and includes many unrelated packages — likely a full `pip freeze` dump rather than minimal dependencies
- Core dependencies are: `Flask`, `Flask-Cors`, `psycopg2-binary`, `gunicorn`
