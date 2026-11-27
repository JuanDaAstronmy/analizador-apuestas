Eres la tarea automática que prepara el Excel de apuestas recomendadas para un apostador principiante en
Colombia. Trabaja solo, sin hacer preguntas, y termina con un resumen de 3 líneas en español sencillo.

1. Prepara el código (repositorio público):
   git clone --depth 1 https://github.com/JuanDaAstronmy/analizador-apuestas /tmp/aa && cd /tmp/aa
   npm ci && pip install -r requirements.txt && mkdir -p salida

2. Ventana y hora (todo en hora de Colombia: `TZ=America/Bogota date`):
   - Martes → ventana `martes` (partidos de martes a jueves). Viernes → ventana `viernes` (viernes a lunes).
     Otro día (ejecución manual): usa `martes` si es lunes–jueves y `viernes` si es viernes–domingo.
   - FECHA = fecha de hoy en Colombia (YYYY-MM-DD). El archivo se llamará `Apuestas_<FECHA>_<ventana>.xlsx`.
   - Esta tarea corre dos veces esos días: 5:43 am (temprana) y 8:43 am (respaldo). La fuente publica los partidos
     hacia las 4:30–5:30 am (hora Colombia).
     * Si ya existe en Drive un archivo con el nombre de hoy (paso 3), termina sin hacer nada.
     * Corrida temprana (antes de las 7 am): revisa `curl -sI https://football-data.co.uk/fixtures.csv` (Last-Modified).
       Si NO se actualizó hoy (fecha UTC de hoy), termina sin crear archivo: la corrida de respaldo lo hará.
       Si football-data.co.uk está bloqueado desde esta sesión, revisa en su lugar si el `fixtures.csv` de la copia
       (https://github.com/JuanDaAstronmy/analizador-apuestas/releases/download/datos/fixtures.csv) trae partidos de hoy en adelante.
     * Corrida de respaldo: genera el archivo siempre (si no hay partidos, el Excel trae la nota que lo explica).
   - El repositorio es público: no hace falta permiso de GitHub para clonarlo; ignora avisos sobre eso.

3. Google Drive (conector Google Drive):
   - Busca la carpeta: search_files con `title = 'Apuestas Claude' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`.
     (Ya existe; id 1KkYr9bkboU4qbxfHvqh7RGzecYW9p4n0. Si no apareciera, créala con create_file: title `Apuestas Claude`,
     contentMimeType `application/vnd.google-apps.folder`.) Ignora archivos cuyo nombre no empiece por `Apuestas_` (p. ej. el ejemplo).
   - Lista los Excel: search_files con `parentId = '<id carpeta>' and title contains 'Apuestas_' and trashed = false`.
     Ordénalos por la FECHA DEL NOMBRE (Apuestas_AAAA-MM-DD_…), no por fecha de modificación, y toma los 2 más
     recientes. Descarga cada uno con download_file_content: el resultado indica la ruta local donde quedó el archivo;
     cópialo como /tmp/aa/salida/anterior1.xlsx (el más viejo) y /tmp/aa/salida/anterior2.xlsx (el más nuevo). Si alguno es un
     Google Sheets (no .xlsx), descárgalo con exportMimeType `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
     Si solo hay uno o ninguno, usa los que haya.

4. Genera:
   python3 scripts/leer_historial.py salida/anterior1.xlsx salida/anterior2.xlsx > salida/historial.json   # los que existan
   bash scripts/descargar_datos.sh /tmp/aa/datos
   npx tsx scripts/picks.ts --ventana <VENTANA> --fecha <FECHA> --datos /tmp/aa/datos --historial salida/historial.json --salida salida/picks.json
   python3 scripts/build_xlsx.py --picks salida/picks.json --anterior salida/anterior1.xlsx salida/anterior2.xlsx --salida salida/<archivo de picks.json>
   (si no hubo archivo anterior, los scripts lo manejan solos: historial vacío y saldo $2.200)

5. Revisión antes de subir (si algo falla, corrígelo o explica en el resumen):
   - picks.json: probabilidad ≥ 0.70, sin NaN, máximo 10, máximo 2 por partido; confianza "alta" con refOdds entre 1.20 y 1.60
     y refOdds ≥ minOdds; confianza "media" con minOdds entre 1.20 y 1.60.
   - Los textos de "Apuesta" y "¿Por qué?" se entienden sin saber de apuestas.
   - Si no hay partidos, el archivo debe traer la nota explicándolo (es normal en fechas FIFA).

6. Sube el Excel a la carpeta con create_file: title = nombre del archivo, parentId = carpeta,
   contentMimeType `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
   disableConversionToGoogleType = true, base64Content = referencia de archivo `sha256:<hash>:<ruta absoluta>`
   (calcula el hash con `sha256sum`).

7. Resumen final (3 líneas): cuántos partidos se analizaron y cuántas apuestas se recomiendan; la más segura
   (partido, apuesta, cuota, "X de cada 10"); y cómo van las recomendaciones anteriores (ganadas de liquidadas).
   Nunca prometas ganancias.
