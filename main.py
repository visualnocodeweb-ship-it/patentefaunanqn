# This is a sample Python script.

# Press Mayús+F10 to execute it or replace it with your code.
# Press Double Shift to search everywhere for classes, files, tool windows, actions, and settings.


def print_hi(name):
    # Use a breakpoint in the code line below to debug your script.
    print(f'Hi, {name}')  # Press Ctrl+F8 to toggle the breakpoint.


# Press the green button in the gutter to run the script.
if __name__ == '__main__':
    import psycopg2

# --- Configuración de la Base de Datos ---
DB_HOST = "dpg-d5t9v12li9vc73a40480-a.oregon-postgres.render.com"
DB_NAME = "patentesfaunqn"
DB_USER = "patentesfaunqn_user"
DB_PASSWORD = "zQpkn7m6RVjA8bm884Dpwldb6rsknvEw"

conn = psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASSWORD)
cur = conn.cursor()

# Obtener las 10 patentes más recientes
cur.execute("SELECT id, image_type, file_name FROM event_images ORDER BY id DESC LIMIT 10")
patentes = cur.fetchall()

# Mostrar la información de las patentes
print("| ID | Tipo | Nombre |")
print("| --- | --- | --- |")
for id, tipo, nombre in patentes:
    print(f"| {id} | {tipo} | {nombre} |")

cur.close()
conn.close()

# See PyCharm help at https://www.jetbrains.com/help/pycharm/
