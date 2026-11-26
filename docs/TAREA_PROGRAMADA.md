Eres la tarea automática que prepara el Excel de apuestas recomendadas para un apostador principiante en
Colombia. Trabaja solo, sin hacer preguntas, y termina con un resumen de 3 líneas en español sencillo.

1. Prepara el código (repositorio público):
   git clone --depth 1 https://github.com/JuanDaAstronmy/analizador-apuestas /tmp/aa && cd /tmp/aa
   npm ci && pip install -r requirements.txt

2. Ventana: mira el día de hoy en hora de Colombia (TZ=America/Bogota date +%u).
   1=lunes → `lunes`, 2=martes → `martes`, 4=jueves → `jueves`, 5=viernes → `viernes`.
   Cualquier otro día: usa la ventana del día de ejecución más cercano anterior de esa lista.
   FECHA = fecha de hoy en Colombia (YYYY-MM-DD).

3. Google Drive (conector Google Drive):
   - Busca la carpeta: search_files con `title = 'Apuestas Claude' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`.
     Si no existe, créala con create_file (contentMimeType no; mimeType de carpeta: `application/vnd.google-apps.folder`, title `Apuestas Claude`).
   - Lista los Excel: search_files con `parentId = '<id carpeta>' and title contains 'Apuestas_' and trashed = false`.
     Ordénalos por la FECHA DEL NOMBRE (Apuestas_AAAA-MM-DD_…), no por fecha de modificación, y toma los 2 más
     recientes. Descarga cada uno con download_file_content y guárdalo decodificado (base64) como
     /tmp/aa/salida/anterior1.xlsx (el más viejo) y /tmp/aa/salida/anterior2.xlsx (el más nuevo). Si alguno es un
     Google Sheets (no .xlsx), descárgalo con exportMimeType `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
     Si solo hay uno o ninguno, usa los que haya.

4. Genera:
   mkdir -p salida
   python3 scripts/leer_historial.py salida/anterior1.xlsx salida/anterior2.xlsx > salida/historial.json   # los que existan
   bash scripts/descargar_datos.sh /tmp/aa/datos
   npx tsx scripts/picks.ts --ventana <VENTANA> --fecha <FECHA> --datos /tmp/aa/datos --historial salida/historial.json --salida salida/picks.json
   python3 scripts/build_xlsx.py --picks salida/picks.json --anterior salida/anterior1.xlsx salida/anterior2.xlsx --salida salida/<archivo de picks.json>
   (si no hubo archivo anterior, los scripts lo manejan solos: historial vacío y saldo $2.200)

5. Revisión antes de subir (si algo falla, corrígelo o explica en el resumen):
   - picks.json: cada recomendación con cuota entre 1.20 y 1.60, probabilidad ≥ 0.70, sin NaN, máximo 10, máximo 2 por partido.
   - Los textos de "Apuesta" y "¿Por qué?" se entienden sin saber de apuestas.
   - Si no hay partidos, el archivo debe traer la nota explicándolo (es normal en fechas FIFA).

6. Sube el Excel a la carpeta con create_file: title = nombre del archivo, parentId = carpeta,
   contentMimeType `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
   disableConversionToGoogleType = true, base64Content = referencia de archivo `sha256:<hash>:<ruta absoluta>`
   (calcula el hash con `sha256sum`).

7. Resumen final (3 líneas): cuántos partidos se analizaron y cuántas apuestas se recomiendan; la más segura
   (partido, apuesta, cuota, "X de cada 10"); y cómo van las recomendaciones anteriores (ganadas de liquidadas).
   Nunca prometas ganancias.
