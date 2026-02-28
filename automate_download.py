import os
import datetime
from dotenv import load_dotenv

load_dotenv()

import db_utils

OUTPUT_DIR = "imagenes_descargadas_automaticas"
TIMESTAMP_FILE = "last_processed_timestamp.txt"

def get_last_processed_cursor():
    """Reads cursor from file. Format: <iso_timestamp>|<image_id>. Legacy: <iso_timestamp>."""
    if os.path.exists(TIMESTAMP_FILE):
        with open(TIMESTAMP_FILE, 'r') as f:
            raw = f.read().strip()
            if not raw:
                return None, None
            if "|" in raw:
                ts_str, image_id = raw.split("|", 1)
                return datetime.datetime.fromisoformat(ts_str), (image_id or None)
            return datetime.datetime.fromisoformat(raw), None
    return None, None

def update_last_processed_cursor(timestamp, image_id):
    """Writes cursor as <iso_timestamp>|<image_id> (or timestamp only if id is missing)."""
    with open(TIMESTAMP_FILE, 'w') as f:
        if image_id:
            f.write(f"{timestamp.isoformat()}|{image_id}")
        else:
            f.write(timestamp.isoformat())

def download_new_images():
    """
    Fetches new images from the database and saves them to a local directory.
    """
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    last_timestamp, last_image_id = get_last_processed_cursor()
    print(f"Buscando nuevas imágenes desde: {last_timestamp if last_timestamp else 'el inicio'}")

    new_images = db_utils.fetch_new_images_for_download(last_timestamp, last_image_id)

    if not new_images:
        print("No se encontraron nuevas imágenes.")
        return

    latest_timestamp_in_batch = last_timestamp
    latest_image_id_in_batch = last_image_id

    for img_data_row in new_images:
        img_id = img_data_row['image_id']
        img_type = img_data_row['image_type']
        file_name = img_data_row['file_name']
        image_bytes = img_data_row['image_data']
        created_at = img_data_row['created_at']

        if image_bytes is None:
            print(f"Skipping image {img_id} as it has no image_data.")
            continue

        extension = ".bin"
        if file_name and "." in file_name:
            ext = os.path.splitext(file_name)[1].lower()
            if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                extension = ext
        elif img_type and "jpeg" in img_type.lower():
            extension = ".jpeg"
        elif img_type and "png" in img_type.lower():
            extension = ".png"

        output_filename = f"{img_id}_{img_type}{extension}"
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        try:
            with open(output_path, 'wb') as f:
                f.write(image_bytes)
            print(f"Imagen descargada: {output_path}")
            # Rows are ordered by (created_at, image_id), so the last processed row
            # is the next safe cursor.
            latest_timestamp_in_batch = created_at
            latest_image_id_in_batch = str(img_id)
        except Exception as e:
            print(f"Error al guardar la imagen {output_filename}: {e}")
    
    if latest_timestamp_in_batch and (
        latest_timestamp_in_batch != last_timestamp
        or str(latest_image_id_in_batch or '') != str(last_image_id or '')
    ):
        update_last_processed_cursor(latest_timestamp_in_batch, latest_image_id_in_batch)
        print(f"Último cursor procesado actualizado a: {latest_timestamp_in_batch}|{latest_image_id_in_batch}")

if __name__ == "__main__":
    download_new_images()
