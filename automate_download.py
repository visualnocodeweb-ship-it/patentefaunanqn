import db_utils
import os
import datetime
import time

OUTPUT_DIR = "imagenes_descargadas_automaticas"
TIMESTAMP_FILE = "last_processed_timestamp.txt"

def get_last_processed_timestamp():
    """Reads the last processed timestamp from a file."""
    if os.path.exists(TIMESTAMP_FILE):
        with open(TIMESTAMP_FILE, 'r') as f:
            timestamp_str = f.read().strip()
            if timestamp_str:
                return datetime.datetime.fromisoformat(timestamp_str)
    return None

def update_last_processed_timestamp(timestamp):
    """Writes the given timestamp to a file."""
    with open(TIMESTAMP_FILE, 'w') as f:
        f.write(timestamp.isoformat())

def download_new_images():
    """
    Fetches new images from the database and saves them to a local directory.
    """
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    last_timestamp = get_last_processed_timestamp()
    print(f"Buscando nuevas imágenes desde: {last_timestamp if last_timestamp else 'el inicio'}")

    new_images = db_utils.fetch_new_images_for_download(last_timestamp)

    if not new_images:
        print("No se encontraron nuevas imágenes.")
        return

    latest_timestamp_in_batch = last_timestamp

    for img_data_row in new_images:
        img_id = img_data_row['id']
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
            if latest_timestamp_in_batch is None or created_at > latest_timestamp_in_batch:
                latest_timestamp_in_batch = created_at
        except Exception as e:
            print(f"Error al guardar la imagen {output_filename}: {e}")
    
    if latest_timestamp_in_batch and latest_timestamp_in_batch != last_timestamp:
        update_last_processed_timestamp(latest_timestamp_in_batch)
        print(f"Último timestamp procesado actualizado a: {latest_timestamp_in_batch}")

if __name__ == "__main__":
    download_new_images()
