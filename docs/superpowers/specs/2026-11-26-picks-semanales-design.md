# Diseño: Excel de apuestas recomendadas (lunes y jueves)

Fecha: 2026-11-26 · Estado: listo para aprobación

## 1. Intención (el porqué)

El usuario (apostador principiante, Colombia, BetPlay y Rushbet) dejó de lado la app móvil y quiere
**recibir dos veces por semana un Excel en Google Drive con las mejores apuestas**, generado
automáticamente por Claude como tarea programada. Su objetivo es crecer un bankroll pequeño
(hoy $2.200 COP) con apuestas de cuota baja, **ganando ~5 % de su saldo por apuesta**, y aprender
qué funciona para ir ajustando el método.

Pidió explícitamente:
- Que la **forma actual** del equipo pese más que la historia: base en los **últimos 3 partidos**, y
  si hay una **racha larga** (victorias, goles, córners, etc.) la racha pesa todavía más.
- **Todos los tipos de apuesta**, no solo ganador y goles, para tener alternativas cuando no hay una
  victoria segura.
- **Lenguaje sencillo**, para alguien que solo conoce lo básico de apuestas.

Enfoque elegido (opción A): **probabilidad de las casas más exactas del mercado + ajuste por forma y
rachas**.

## 2. Metas, no-metas y anti-metas

**Metas**
- Un archivo .xlsx nuevo en Drive cada **lunes** (partidos lunes→jueves) y cada **jueves**
  (partidos viernes→domingo), sin intervención del usuario.
- Lista corta y ordenada de apuestas "más seguras" en el rango de cuota útil para su plan, con
  explicación en una línea por apuesta.
- Un **historial** que muestre cómo le fue a las recomendaciones anteriores (ganó/perdió), para
  poder ajustar el método con datos.

**No-metas**
- No hace apuestas ni lee cuotas de BetPlay/Rushbet (no hay acceso público). Las cuotas del Excel son
  de referencia; el usuario confirma en su casa.
- No incluye Champions/torneos internacionales ni la Liga BetPlay (no están en la fuente de datos).
- No se sigue desarrollando la app móvil (queda en el repo tal cual).

**Anti-metas (sería un fracaso aunque "funcione")**
- Que el ajuste por rachas se aleje tanto del mercado que recomiende apuestas que el mercado
  considera malas (las rachas se sobrevaloran fácilmente): el ajuste debe tener **tope**.
- Lenguaje técnico (log-loss, Kelly, overround…) en el Excel.
- Prometer ganancias o esconder el riesgo: cada archivo muestra cuánto se pierde si falla.
- Esconder el tamaño del riesgo: si una apuesta es más de 1/4 del saldo, se muestra un aviso en rojo
  (el usuario decidió seguir apostando el mínimo aunque el saldo baje; ver 6).

## 3. Restricciones

- **Apuesta mínima: $500.** Con saldo $2.200 la meta del 5 % = $110 de ganancia:
  stake = 110 / (cuota − 1). Ese stake es ≥ $500 solo si cuota ≤ 1.22. Para cuotas más altas se
  apuesta el mínimo ($500) y se gana más del 5 %.
- **Datos**: football-data.co.uk vía la copia en la release `datos` del repo (el sitio está
  bloqueado en Colombia, pero la tarea corre en la nube). Disponibles:
  - Resultados con goles, **xG** (temporada actual en ligas principales), **córners, tarjetas,
    árbitro** (solo Premier) para 9 ligas europeas; Argentina/Brasil/México/MLS solo goles y cuotas.
  - Próximos partidos (`fixtures.csv`, `new_league_fixtures.csv`) con cuotas 1X2, más/menos 2.5 y
    hándicap asiático de **Betfair Exchange, promedio y máximo del mercado**. Se publican pocos días
    antes de cada jornada.
  - No hay cuotas de córners ni tarjetas.
- **Ejecución**: tarea programada de Claude Code (nueva sesión en cada disparo) en el entorno
  "MetodosComputacionales1012" (acceso a football-data.co.uk y GitHub), con el conector de
  **Google Drive** guardado en la tarea.
- El workflow de GitHub que copia los datos corre lunes/miércoles/viernes a las 06:23 (Colombia):
  hay que pasarlo a **diario** para que el jueves haya datos frescos.

## 4. Enfoques considerados

| | Enfoque | A favor | En contra |
|---|---|---|---|
| **A (elegido)** | Mercado exacto (Betfair + promedio) como base + ajuste por forma/rachas con tope | Lo más parecido a un profesional; respeta la idea de rachas | Córners/tarjetas sin referencia de mercado → menos confiables |
| B | Solo forma/rachas (modelo propio) | Fiel a la idea del usuario, simple | En backtests los modelos propios perdieron contra el mercado |
| C | Solo mercado | El más preciso en promedio | Ignora las rachas que pidió el usuario |

## 5. El algoritmo (cómo se elige cada apuesta)

### 5.1 Base de mercado (goles y ganador)
1. Para cada partido próximo, tomar cuotas 1X2 y más/menos 2.5: preferir **Betfair Exchange (BFE)**,
   si falta usar **promedio (Avg)**. Quitar el margen (normalizar).
2. Encontrar los goles esperados de cada equipo (λ local, λ visitante) de un modelo de Poisson que
   **reproduzca** esas probabilidades de mercado (ajuste numérico de 2 parámetros).
3. Con esa matriz de marcadores salen, coherentes con el mercado, todos los mercados de goles:
   1X2, doble oportunidad, empate no apuesta, más/menos 0.5–4.5, ambos marcan, goles de cada equipo,
   hándicaps ±1.5, gana y ambos marcan, etc.
4. Si un partido no trae cuotas, se usa el modelo propio (Dixon-Coles del repo) con pesos fuertes
   en lo reciente y se marca "sin referencia de mercado".

### 5.2 Ajuste por forma y rachas (lo que pidió el usuario)
- **Forma reciente**: para cada equipo, goles a favor/en contra, xG, córners y tarjetas con pesos
  **50 % últimos 3 partidos, 30 % partidos 4–8, 20 % resto de la temporada**.
- **Rachas**: contar partidos consecutivos (más recientes) que cumplen una condición: ganó, no
  perdió, marcó, recibió gol, más de 2.5 en su partido, ambos marcaron, córners de su partido sobre
  la media, tarjetas sobre la media. Racha de **5+** activa ajuste; crece con la longitud y se
  satura (~10+). Una racha de 15 pesa más que la forma de 3 partidos, como pidió el usuario.
- **Cómo se aplica**: la forma y las rachas mueven λ (goles) y las tasas de córners/tarjetas. En
  mercados con referencia de mercado, la probabilidad final **no puede alejarse más de ±6 puntos**
  de la del mercado (tope de la anti-meta).

### 5.3 Córners y tarjetas (sin cuotas de mercado)
- Tasas por equipo (a favor/en contra, local/visitante) con los mismos pesos de forma y rachas,
  modelo de conteo (binomial negativa, dispersión estimada por liga).
- Tarjetas: en la Premier se usa además el **promedio de tarjetas del árbitro** asignado
  (columna Referee).
- Estas apuestas se marcan "confianza media" y como **cuota de referencia** se muestra la cuota
  mínima a la que valdría la pena (1/probabilidad), porque no hay cuota real.

### 5.4 Selección y orden
- Candidatas: todas las selecciones de todos los partidos de la ventana (lunes→jueves o
  viernes→domingo).
- **Cuota de referencia**: para mercados con cuotas en los datos, la del mercado (Avg). Para mercados
  derivados sin precio (doble oportunidad, más de 1.5, ambos marcan, córners, tarjetas…), la cuota
  justa **con el margen típico de BetPlay (7,5 %)**: cuota = 1 / (p × 1.075). *(Decisión de Claude:
  medido en las capturas de BetPlay del usuario.)* Lo mismo para "no apuestes si tu casa paga menos de"
  = 1 / p_final (cuota justa, el punto de equilibrio).
- Filtro: cuota de referencia entre **1.20 y 1.60** y probabilidad final ≥ **70 %**.
- Orden: por probabilidad final; desempate por "margen de seguridad" (prob. final − prob. implícita
  de la cuota).
- Máximo **10** recomendaciones por archivo y **máximo 2 por partido**; se prioriza variedad de
  mercados cuando no hay victorias seguras.

## 6. El Excel

Nombre: `Apuestas_AAAA-MM-DD_(lunes|jueves).xlsx`, en una carpeta de Drive **"Apuestas Claude"**
(se crea si no existe).

**Hoja 1 "Apuestas de hoy"** (lo primero que ve):
- Arriba: celda **"Mi saldo"** (editable). Valor por defecto: el saldo calculado en la hoja "Mis
  apuestas" del archivo anterior en Drive; si no existe, $2.200. *(Decisión de Claude.)* Meta del 5 %
  y apuesta mínima $500. Stake = máx(500, 5 % × saldo / (cuota − 1)), recalculado con fórmulas.
- **Saldo bajo (decisión del usuario, opción 1):** se sigue recomendando con el mínimo de $500 aunque
  el saldo baje; si el stake supera 1/4 del saldo, la fila muestra en rojo "Esta apuesta es X % de tu
  saldo". Solo se deja de recomendar si el saldo es menor que $500.
- Una fila por recomendación: fecha y hora (Colombia), liga, partido, **apuesta en palabras simples**
  ("Gana el Inter", "Habrá 3 goles o más", "El Getafe no pierde"), cuota de referencia,
  **"no apuestes si tu casa paga menos de"**, probabilidad aproximada ("8 de cada 10"), cuánto
  apostar, cuánto ganas si sale, cuánto pierdes si falla, y **por qué** (1 línea, ej. "El Inter
  lleva 6 victorias seguidas; el rival perdió 4 de sus últimos 5 de visitante").
- Colores: verde = más segura, amarillo = buena, gris = alternativa.

**Hoja 2 "Cómo usar"**: 6–8 líneas: confirmar la cuota en tu casa, una sola apuesta a la vez, si
pierdes 2 seguidas descansa hasta el siguiente archivo, qué significa cada tipo de apuesta.

**Hoja 3 "Mis apuestas"** (lo que el usuario llena; se arrastra de archivo en archivo):
- Preguntas por fila, en lenguaje simple: **¿Cuál apostaste?** (lista desplegable con las
  recomendaciones o "otra, idea mía"), **¿En qué casa?**, **¿Cuánto apostaste?**, **¿Qué cuota te
  dieron de verdad?**, **¿Ganó?** (se prellena solo cuando la tarea conoce el resultado; el usuario
  puede corregirlo), **¿Por qué la elegiste? / tu intuición** (texto libre: la "parte humana").
- Columnas calculadas: ganancia/pérdida, saldo después de cada apuesta, ganancia esperada de esa
  apuesta (stake × (p × cuota real − 1)).
- Cada ejecución lee esta hoja del archivo anterior en Drive y la copia al nuevo (no se pierde nada).
  Si el usuario no llenó nada, queda vacía.
- Resumen: apuestas hechas, aciertos, ganancia real, ganancia esperada, y **comparación "recomendadas
  por Claude" vs "ideas mías"** (aciertos y ganancia de cada grupo).

**Gráficas** (gráficas nativas de Excel, se actualizan solas al escribir en "Mis apuestas"):
1. **Mi saldo real vs esperado**: línea del saldo real después de cada apuesta, línea del saldo
   esperado (sumando la ganancia esperada de cada apuesta) y línea de la meta ideal (+5 % por
   apuesta ganada seguida).
2. **Cómo le va a las recomendaciones** (hoja "Historial"): aciertos acumulados de todas las
   recomendaciones vs lo que se esperaba según sus probabilidades.

**Hoja 4 "Historial"**: todas las recomendaciones anteriores con resultado (✅/❌) aunque el usuario
no las haya apostado, y un resumen: aciertos, % de acierto, y cuánto habría ganado/perdido siguiendo
la regla del 5 % desde $2.200.

## 7. Historial y aprendizaje
- Cada ejecución guarda sus recomendaciones en el repo (`picks/historial.json`) y hace commit.
- La siguiente ejecución liquida las pendientes con los resultados (goles, córners y tarjetas están
  en los CSV) y actualiza el resumen. Así se ve con datos si el método funciona y qué mercados
  rinden mejor.

## 8. Automatización
- Código nuevo en el repo `analizador-apuestas`: el modelo en TypeScript (reutiliza `src/core`),
  `scripts/picks.ts`, produce las recomendaciones en JSON; un script Python con **openpyxl** arma el
  .xlsx (openpyxl soporta gráficas nativas de Excel, que `exceljs` no). *(Decisión de Claude.)*
- Antes de generar, la tarea descarga de Drive el archivo anterior para leer "Mi saldo" y "Mis
  apuestas".
- **Tarea programada** de Claude: lunes y jueves ~07:15 (Colombia), nueva sesión cada vez, con el
  conector Google Drive. Instrucciones: actualizar repo, correr el script, revisar el resultado
  (sanidad: hay partidos, cuotas razonables), subir el .xlsx a Drive, commit del historial.
- Workflow `datos.yml` pasa a correr **todos los días** a las 06:23 (Colombia) y descarga también las
  ligas de `new_league_fixtures.csv` que hoy no baja (Japón, Noruega, Suecia, Austria, etc.), para
  tener historia y rachas de todas las ligas con partidos próximos. *(Decisión de Claude.)*
- **Tarjetas**: cada tarjeta cuenta 1 (amarilla o roja). *(Decisión de Claude; si la casa del usuario
  cuenta distinto, se ajusta.)*
- Si no hay partidos publicados en la ventana, el archivo se sube igual con una nota clara
  ("aún no hay cuotas de los partidos del fin de semana") y lo que sí haya.

## 9. Decisiones dejadas al constructor
- Detalles numéricos finos (fórmula exacta de saturación de rachas, peso del árbitro), siempre
  respetando el tope de ±6 puntos y el filtro 1.20–1.60 / ≥70 %.
- Formato visual del Excel dentro de lo descrito.
- Pruebas: unitarias para la reproducción del mercado (λ que reproduce 1X2 y 2.5), rachas y
  liquidación del historial; una corrida completa con datos reales antes de programar la tarea.
