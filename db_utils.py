import logging
import psycopg2
import base64
import os
import datetime
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Mapeo para normalizar marcas de vehículos
VEHICLE_BRAND_NORMALIZATION_MAP = {
    "Cheurolet": "Chevrolet",
    "Evolkswagen": "Volkswagen",
    "Renau": "Renault",
}

def normalize_vehicle_brand(brand):
    """Normaliza una cadena de marca de vehículo usando un mapeo predefinido."""
    if brand is None:
        return None
    # Convertir a minúsculas para una comparación insensible a mayúsculas/minúsculas antes de buscar en el mapa
    # y luego aplicar la corrección si existe, de lo contrario, devolver la marca original con la primera letra en mayúscula
    normalized_brand_lower = brand.lower()
    for incorrect, correct in VEHICLE_BRAND_NORMALIZATION_MAP.items():
        if normalized_brand_lower == incorrect.lower():
            return correct
    # Si no se encuentra en el mapa, intentar capitalizar la primera letra (esto es un guess, podría no ser lo mejor)
    return brand.capitalize()

# --- Configuración de la Base de Datos ---
DB_HOST = os.environ["DB_HOST"]
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_PASSWORD = os.environ["DB_PASSWORD"]

def get_db_connection():
    """Establece y devuelve una conexión a la base de datos."""
    conn = psycopg2.connect(
        host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASSWORD,
        connect_timeout=10
    )
    return conn

def fetch_latest_images(limit=5): # Reducido el límite para depuración
    """
    Recupera las últimas imágenes y sus datos de detección de patente.
    Retorna una lista de diccionarios con la información combinada.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        query = """
        SELECT
            de.id AS event_id,
            ei.id AS image_id,
            ei.created_at,
            ei.image_data,
            ei.image_type,
            ei.file_name,
            de.camera_plate_text AS plate_text,
            de.camera_confidence AS plate_confidence
        FROM
            detection_events de
        JOIN
            event_images ei ON de.id = ei.event_id
        ORDER BY
            ei.created_at DESC
        LIMIT %s;
        """
        cur.execute(query, (limit,))

        columns = [desc[0] for desc in cur.description]
        results = []
        rows = cur.fetchall()
        for row in rows:
            row_dict = dict(zip(columns, row))
            if 'vehicle_brand' in row_dict: # Asegurarse de que el campo exista
                row_dict['vehicle_brand'] = normalize_vehicle_brand(row_dict['vehicle_brand'])
            if row_dict['image_data']:
                row_dict['image_data'] = base64.b64encode(row_dict['image_data']).decode('utf-8')
            results.append(row_dict)
        
        cur.close()
        return results

    except psycopg2.Error as e:
        logger.error("Error de base de datos al obtener últimas imágenes: %s", e)
        return []
    except Exception as e:
        logger.error("Un error inesperado ocurrió al obtener últimas imágenes: %s", e)
        return []
    finally:
        if conn:
            conn.close()


def fetch_new_images_for_download(last_timestamp=None):
    """
    Recupera imágenes creadas después de last_timestamp.
    Retorna una lista de diccionarios con la información de la imagen (image_data en bytes).
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        query = """
        SELECT
            de.id AS event_id,
            ei.id AS image_id,
            ei.created_at,
            ei.image_data,
            ei.image_type,
            ei.file_name,
            de.camera_plate_text AS plate_text,
            de.camera_confidence AS plate_confidence
        FROM
            detection_events de
        JOIN
            event_images ei ON de.id = ei.event_id
        WHERE
            (%s IS NULL OR de.created_at > %s)
        ORDER BY
            de.created_at ASC;
        """
        cur.execute(query, (last_timestamp, last_timestamp))
        
        columns = [desc[0] for desc in cur.description]
        results = []
        for row in cur.fetchall():
            row_dict = dict(zip(columns, row))
            # image_data se deja en formato bytes para guardar directamente
            results.append(row_dict)
        
        cur.close()
        return results

    except psycopg2.Error as e:
        logger.error("Error de base de datos al obtener nuevas imágenes para descarga: %s", e)
        return []
    except Exception as e:
        logger.error("Un error inesperado ocurrió al obtener nuevas imágenes para descarga: %s", e)
        return []
    finally:
        if conn:
            conn.close()

def fetch_images_by_datetime_range(start_datetime_str, end_datetime_str, limit=500):
    """
    Recupera imágenes y sus datos de detección de patente dentro de un rango de fecha y hora.
    start_datetime_str y end_datetime_str deben ser cadenas en formato ISO (YYYY-MM-DDTHH:MM:SS).
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Convertir cadenas a objetos datetime para la consulta
        start_dt = datetime.datetime.fromisoformat(start_datetime_str)
        end_dt = datetime.datetime.fromisoformat(end_datetime_str)



        query = """
        SELECT
            de.id AS event_id,
            ei.id AS image_id,
            ei.created_at,
            ei.image_data,
            ei.image_type,
            ei.file_name,
            de.camera_plate_text AS plate_text,
            de.camera_confidence AS plate_confidence
        FROM
            detection_events de
        JOIN
            event_images ei ON de.id = ei.event_id
        WHERE
            de.created_at >= %s AND de.created_at <= %s
        ORDER BY
            de.created_at DESC
        LIMIT %s;
        """
        cur.execute(query, (start_dt, end_dt, limit))
        
        columns = [desc[0] for desc in cur.description]
        results = []
        rows = cur.fetchall()

        for row in rows:
            row_dict = dict(zip(columns, row))
            if 'vehicle_brand' in row_dict: # Asegurarse de que el campo exista
                row_dict['vehicle_brand'] = normalize_vehicle_brand(row_dict['vehicle_brand'])
            if row_dict['image_data']:
                row_dict['image_data'] = base64.b64encode(row_dict['image_data']).decode('utf-8')
            results.append(row_dict)

        cur.close()
        return results

    except (ValueError, TypeError) as e:
        logger.error("Error en el formato de fecha/hora: %s", e)
        return []
    except psycopg2.Error as e:
        logger.error("Error de base de datos al buscar por rango de fecha/hora: %s", e)
        return []
    except Exception as e:
        logger.error("Un error inesperado ocurrió al buscar por rango de fecha/hora: %s", e)
        return []
    finally:
        if conn:
            conn.close()

def search_by_plate_text(plate_text, limit=50):
    """
    Busca imágenes y datos de detección de patente por el texto de la patente.
    Retorna una lista de diccionarios con la información combinada.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        query = """
        SELECT
            de.id AS event_id,
            ei.id AS image_id,
            ei.created_at,
            ei.image_data,
            ei.image_type,
            ei.file_name,
            de.camera_plate_text AS plate_text,
            de.camera_confidence AS plate_confidence
        FROM
            detection_events de
        JOIN
            event_images ei ON de.id = ei.event_id
        WHERE
            de.camera_plate_text ILIKE %s
        ORDER BY
            de.created_at DESC
        LIMIT %s;
        """
        cur.execute(query, (f'%{plate_text}%', limit))
        
        columns = [desc[0] for desc in cur.description]
        results = []
        for row in cur.fetchall():
            row_dict = dict(zip(columns, row))
            if 'vehicle_brand' in row_dict: # Asegurarse de que el campo exista
                row_dict['vehicle_brand'] = normalize_vehicle_brand(row_dict['vehicle_brand'])
            if row_dict['image_data']:
                row_dict['image_data'] = base64.b64encode(row_dict['image_data']).decode('utf-8')
            results.append(row_dict)
        
        cur.close()
        return results

    except psycopg2.Error as e:
        logger.error("Error de base de datos al buscar por patente: %s", e)
        return []
    except Exception as e:
        logger.error("Un error inesperado ocurrió al buscar por patente: %s", e)
        return []
    finally:
        if conn:
            conn.close()

def _validate_date(value):
    """Validate and return an ISO date/datetime string, or None if invalid."""
    if not value:
        return None
    try:
        datetime.datetime.fromisoformat(value)
        return value
    except (ValueError, TypeError):
        return None

def _build_where_clause(search_term=None, brand_filter=None, type_filter=None,
                        start_date_filter=None, end_date_filter=None, min_confidence_filter=None):
    """Builds a shared WHERE clause and params list for detection_events queries."""
    conditions = []
    params = []
    if search_term:
        conditions.append("camera_plate_text ILIKE %s")
        params.append(f'%{search_term}%')
    if brand_filter:
        conditions.append("vehicle_brand ILIKE %s")
        params.append(f'%{brand_filter}%')
    if type_filter:
        conditions.append("vehicle_type ILIKE %s")
        params.append(f'%{type_filter}%')
    start_date_filter = _validate_date(start_date_filter)
    if start_date_filter:
        conditions.append("created_at >= %s")
        params.append(start_date_filter)
    end_date_filter = _validate_date(end_date_filter)
    if end_date_filter:
        conditions.append("created_at <= %s")
        params.append(end_date_filter)
    if min_confidence_filter is not None:
        min_confidence_filter = max(0.0, min(1.0, float(min_confidence_filter)))
        conditions.append("camera_confidence >= %s")
        params.append(min_confidence_filter)
    clause = ""
    if conditions:
        clause = " WHERE " + " AND ".join(conditions)
    return clause, params

def fetch_all_patents_paginated(page=1, page_size=10, search_term=None, brand_filter=None,
                                type_filter=None, start_date_filter=None, end_date_filter=None,
                                min_confidence_filter=None):
    """
    Recupera todos los datos de patente de detection_events con paginación, búsqueda y filtros.
    Incluye conteo de avistamientos por patente (sightings) via window function.
    Retorna una tupla (lista_de_patentes, total_registros).
    """
    conn = None
    patents = []
    total_count = 0
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        offset = (page - 1) * page_size
        where_clause, query_params = _build_where_clause(
            search_term, brand_filter, type_filter,
            start_date_filter, end_date_filter, min_confidence_filter
        )

        # Consulta de conteo
        cur.execute("SELECT COUNT(*) FROM detection_events" + where_clause, query_params)
        total_count = cur.fetchone()[0]

        # Fetch page of patents (no window function)
        patents_query = """
        SELECT
            id AS event_id,
            camera_plate_text AS plate_text,
            vehicle_brand,
            vehicle_color,
            vehicle_type,
            camera_confidence AS plate_confidence,
            created_at
        FROM
            detection_events
        """ + where_clause + " ORDER BY created_at DESC LIMIT %s OFFSET %s;"

        page_params = list(query_params) + [page_size, offset]
        cur.execute(patents_query, page_params)

        columns = [desc[0] for desc in cur.description]
        for row in cur.fetchall():
            row_dict = dict(zip(columns, row))
            if 'vehicle_brand' in row_dict:
                row_dict['vehicle_brand'] = normalize_vehicle_brand(row_dict['vehicle_brand'])
            patents.append(row_dict)

        # Per-page sightings: count occurrences of plates on this page
        plate_texts = list({p['plate_text'] for p in patents if p.get('plate_text')})
        sightings_map = {}
        if plate_texts:
            placeholders = ','.join(['%s'] * len(plate_texts))
            sightings_query = (
                "SELECT camera_plate_text, COUNT(*) FROM detection_events"
                + " WHERE camera_plate_text IN (" + placeholders + ")"
                + " GROUP BY camera_plate_text"
            )
            cur.execute(sightings_query, plate_texts)
            for plate, count in cur.fetchall():
                sightings_map[plate] = count
        for p in patents:
            p['sightings'] = sightings_map.get(p.get('plate_text'), 0)

        cur.close()
        return patents, total_count

    except (ValueError, TypeError, psycopg2.Error) as e:
        logger.error("Error de base de datos al obtener patentes paginadas o en el formato de fecha: %s", e)
        return [], 0
    except Exception as e:
        logger.error("Un error inesperado ocurrió al obtener patentes paginadas: %s", e)
        return [], 0
    finally:
        if conn:
            conn.close()

def fetch_stats(start_date_filter=None, end_date_filter=None):
    """
    Recupera estadísticas agregadas de detection_events.
    Retorna un diccionario con métricas clave.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        where_clause, params = _build_where_clause(
            start_date_filter=start_date_filter,
            end_date_filter=end_date_filter
        )

        query = """
        SELECT
            COUNT(*) AS total,
            COUNT(DISTINCT camera_plate_text) AS unique_plates,
            COALESCE(AVG(camera_confidence), 0) AS avg_confidence,
            COUNT(*) FILTER (WHERE camera_confidence < 0.7) AS low_confidence_count,
            COUNT(*) FILTER (WHERE camera_confidence >= 0.9) AS high_conf,
            COUNT(*) FILTER (WHERE camera_confidence >= 0.7 AND camera_confidence < 0.9) AS mid_conf,
            MAX(created_at) AS last_detection_at,
            MIN(created_at) AS first_detection_at
        FROM detection_events
        """ + where_clause + ";"

        cur.execute(query, params)
        row = cur.fetchone()
        columns = [desc[0] for desc in cur.description]
        result = dict(zip(columns, row))

        # Compute detections per hour
        if result['first_detection_at'] and result['last_detection_at'] and result['total'] > 0:
            span = result['last_detection_at'] - result['first_detection_at']
            hours = span.total_seconds() / 3600
            result['detections_per_hour'] = round(result['total'] / max(hours, 1), 1)
        else:
            result['detections_per_hour'] = 0

        # Serialize datetimes
        for key in ('last_detection_at', 'first_detection_at'):
            if result[key]:
                result[key] = result[key].isoformat()

        result['avg_confidence'] = round(float(result['avg_confidence']), 4)
        cur.close()
        return result

    except (psycopg2.Error, Exception) as e:
        logger.error("Error al obtener estadísticas: %s", e)
        return None
    finally:
        if conn:
            conn.close()

def fetch_recent_thumbnails(limit=8):
    """
    Fetches the most recent vehicle_picture thumbnails.
    Returns base64-encoded image data filtered server-side by image_type.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        query = """
        SELECT
            de.id AS event_id,
            ei.image_data,
            de.camera_plate_text AS plate_text
        FROM
            detection_events de
        JOIN
            event_images ei ON de.id = ei.event_id
        WHERE
            ei.image_type = 'vehicle_picture'
        ORDER BY
            ei.created_at DESC
        LIMIT %s;
        """
        cur.execute(query, (limit,))
        results = []
        for row in cur.fetchall():
            event_id_val, image_data, plate_text = row
            if image_data:
                results.append({
                    'event_id': event_id_val,
                    'image_data': base64.b64encode(image_data).decode('utf-8'),
                    'plate_text': plate_text
                })
        cur.close()
        return results
    except psycopg2.Error as e:
        logger.error("Error fetching recent thumbnails: %s", e)
        return []
    except Exception as e:
        logger.error("Unexpected error fetching recent thumbnails: %s", e)
        return []
    finally:
        if conn:
            conn.close()

def fetch_image_by_event_id(event_id):
    """
    Recupera todas las imágenes (image_data y image_type) para un event_id dado.
    Retorna una lista de diccionarios con image_data (base64) e image_type.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            query = """
            SELECT
                image_data,
                image_type
            FROM
                event_images
            WHERE
                event_id = %s
            ORDER BY
                CASE image_type
                    WHEN 'vehicle_detection' THEN 1
                    WHEN 'vehicle_picture' THEN 2
                    WHEN 'plate' THEN 3
                    ELSE 4
                END;
            """
            cur.execute(query, (str(event_id),))

            results = []
            for row in cur.fetchall():
                image_data, image_type = row
                if image_data:
                    results.append({
                        'image_data': base64.b64encode(image_data).decode('utf-8'),
                        'image_type': image_type
                    })
            return results
        finally:
            cur.close()

    except psycopg2.Error as e:
        logger.error("Error de base de datos al obtener imagen por event_id: %s", e)
        return None
    except Exception as e:
        logger.error("Un error inesperado ocurrió al obtener imagen por event_id: %s", e)
        return None
    finally:
        if conn:
            conn.close()