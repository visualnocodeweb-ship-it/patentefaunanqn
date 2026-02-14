import psycopg2
import os

# --- Configuración de la Base de Datos ---
DB_HOST = "dpg-d5t9v12li9vc73a40480-a.oregon-postgres.render.com"
DB_NAME = "patentesfaunqn"
DB_USER = "patentesfaunqn_user"
DB_PASSWORD = "zQpkn7m6RVjA8bm884Dpwldb6rsknvEw" # ¡IMPORTANTE! Reemplaza esto con tu contraseña real

# --- Directorio de Salida ---
OUTPUT_DIR = "imagenes_extraidas"

# Asegúrate de que el directorio de salida exista
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

conn = None
try:
    # Establecer la conexión a la base de datos
    print("Conectando a la base de datos...")
    conn = psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    print("Conexión exitosa. Extrayendo imágenes...")

    # Consulta para obtener los datos de las imágenes
    # Puedes modificar esta consulta para filtrar imágenes específicas:
    # Por ejemplo, para un tipo de imagen específico:
    # cur.execute("SELECT id, image_type, file_name, image_data FROM event_images WHERE image_type =
    # 'vehicle_picture' LIMIT 20;")
    # O para un evento específico:
    # cur.execute("SELECT id, image_type, file_name, image_data FROM event_images WHERE event_id = 'TU_EVENT_I
    # LIMIT 1;")
    # Por ahora, extraemos las primeras 100 imágenes (puedes ajustar el LIMIT)
    cur.execute("SELECT id, image_type, file_name, image_data FROM event_images ORDER BY id DESC LIMIT 10;")

    images = cur.fetchall()

    if not images:
        print("No se encontraron imágenes con la consulta actual.")
    else:
        for img_id, img_type, file_name, img_data in images:
            # Intentar determinar la extensión del archivo
            extension = ".bin" # Por defecto si no se puede determinar
            if file_name and "." in file_name:
                ext = os.path.splitext(file_name)[1].lower()
                if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                    extension = ext
            elif "jpeg" in img_type.lower():
                extension = ".jpeg"
            elif "png" in img_type.lower():
                extension = ".png"

            # Crear un nombre de archivo seguro y único
            # Usamos el ID de la imagen para asegurar que sea único
            # Y el tipo de imagen para que sea descriptivo
            output_filename = f"{img_id}_{img_type}{extension}"

            # Si el file_name original es útil y seguro, podríamos intentar usarlo
            # Pero para evitar problemas con caracteres no válidos en rutas, es mejor basarse en el ID.
            # Puedes ajustar esta lógica si confías en los file_name originales.

            output_path = os.path.join(OUTPUT_DIR, output_filename)

            with open(output_path, 'wb') as f:
                f.write(img_data)
            print(f"Imagen guardada: {output_path}")

    cur.close()

except psycopg2.Error as e:
    print(f"Error de base de datos: {e}")
except Exception as e:
    print(f"Un error inesperado ocurrió: {e}")
finally:
    if conn:
        conn.close()
        print("Conexión a la base de datos cerrada.")