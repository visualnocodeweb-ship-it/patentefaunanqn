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

def fetch_all_patents_paginated(page=1, page_size=10, search_term=None, brand_filter=None, type_filter=None, start_date_filter=None, end_date_filter=None):
    """
    Recupera todos los datos de patente de detection_events con paginación, búsqueda y filtros.
    Retorna una tupla (lista_de_patentes, total_registros).
    """
    conn = None
    patents = []
    total_count = 0
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        offset = (page - 1) * page_size

        # Consulta base para patentes
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
        """

        # Consulta base para el conteo total
        count_query = """
        SELECT COUNT(*)
        FROM
            detection_events
        """

        # Construir cláusula WHERE dinámicamente
        where_conditions = []
        query_params = []

        if search_term:
            where_conditions.append("camera_plate_text ILIKE %s")
            query_params.append(f'%{search_term}%')
        
        if brand_filter:
            where_conditions.append("vehicle_brand ILIKE %s")
            query_params.append(f'%{brand_filter}%')

        if type_filter:
            where_conditions.append("vehicle_type ILIKE %s")
            query_params.append(f'%{type_filter}%')
        
        if start_date_filter:
            where_conditions.append("created_at >= %s")
            # Convertir a datetime si es necesario, o asegurarse de que el frontend pase el formato correcto
            query_params.append(start_date_filter)

        if end_date_filter:
            where_conditions.append("created_at <= %s")
            # Convertir a datetime si es necesario, o asegurarse de que el frontend pase el formato correcto
            query_params.append(end_date_filter)

        where_clause = ""
        if where_conditions:
            where_clause = " WHERE " + " AND ".join(where_conditions)
        
        # Ejecutar consulta de conteo
        cur.execute(count_query + where_clause, query_params)
        total_count = cur.fetchone()[0]

        # Ejecutar consulta de patentes con paginación
        patents_query += where_clause + " ORDER BY created_at DESC LIMIT %s OFFSET %s;"
        # Añadir parámetros de paginación al final de los parámetros de filtro
        query_params.extend([page_size, offset])
        
        cur.execute(patents_query, query_params)
        
        columns = [desc[0] for desc in cur.description]
        for row in cur.fetchall():
            row_dict = dict(zip(columns, row))
            if 'vehicle_brand' in row_dict: # Asegurarse de que el campo exista
                row_dict['vehicle_brand'] = normalize_vehicle_brand(row_dict['vehicle_brand'])
            patents.append(row_dict)
        
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

def fetch_image_by_event_id(event_id):
    """
    Recupera la image_data y image_type para un event_id dado.
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
                created_at DESC
            LIMIT 1;
            """
            cur.execute(query, (str(event_id),))

            result = cur.fetchone()

            if result:
                image_data, image_type = result
                if image_data:
                    return {
                        'image_data': base64.b64encode(image_data).decode('utf-8'),
                        'image_type': image_type
                    }
            return None
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