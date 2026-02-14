import base64
from flask import Flask, jsonify, request, render_template
import db_utils

app = Flask(__name__)

@app.route('/')
def index():
    """Renders the main application page."""
    return render_template('index.html')

@app.route('/api/latest_images')
def latest_images():
    print("DEBUG: app.py - /api/latest_images route hit.")
    """Fetches the latest images and associated plate detection data."""
    images = db_utils.fetch_latest_images()
    print("DEBUG: Datos de imágenes fetched:", images) # Línea de depuración añadida
    return jsonify(images)

@app.route('/api/search_plate', methods=['GET'])
def search_plate():
    """
    Searches for images and associated plate detection data based on plate text.
    Expects 'plate' as a query parameter.
    """
    plate_text = request.args.get('plate')
    if not plate_text:
        return jsonify({"error": "Missing 'plate' query parameter"}), 400
    
    results = db_utils.search_by_plate_text(plate_text)
    return jsonify(results)

@app.route('/api/images_by_datetime', methods=['GET'])
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
    if limit is not None:
        results = db_utils.fetch_images_by_datetime_range(start_datetime, end_datetime, limit=limit)
    else:
        results = db_utils.fetch_images_by_datetime_range(start_datetime, end_datetime)
    
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

    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 10

    patents, total_count = db_utils.fetch_all_patents_paginated(page, page_size, search_term)
    
    return jsonify({
        'patents': patents,
        'total_count': total_count,
        'page': page,
        'page_size': page_size
    })

@app.route('/api/image/<event_id>', methods=['GET'])
def get_image(event_id):
    """
    Fetches image data (base64) and type for a given event_id.
    """
    image_data = db_utils.fetch_image_by_event_id(event_id)
    if image_data:
        return jsonify(image_data)
    return jsonify({"error": "Image not found for this event_id"}), 404

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')
