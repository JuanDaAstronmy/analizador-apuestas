# Excel de apuestas (lunes y jueves) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generar dos veces por semana un .xlsx en Google Drive con las apuestas más seguras (cuota 1.20–1.60, prob ≥ 70 %), su historial y la hoja "Mis apuestas" con gráficas, mediante una tarea programada de Claude.

**Architecture:** `scripts/descargar_datos.sh` baja los CSV de la release `datos`. `scripts/picks.ts` (TypeScript, módulos nuevos en `src/picks/`) lee los CSV, ajusta λ al mercado, aplica forma/rachas, calcula córners/tarjetas, elige picks, liquida `picks/historial.json` y escribe `salida/picks.json`. `scripts/build_xlsx.py` (openpyxl) arma el Excel con fórmulas y gráficas nativas, copiando "Mis apuestas" y "Mi saldo" del archivo anterior. La tarea programada orquesta y sube a Drive.

**Tech Stack:** TypeScript + tsx + node:test (existentes), Python 3 + openpyxl 3.1, GitHub Actions, tarea programada Claude Code + conector Google Drive.

**Spec:** `docs/superpowers/specs/2026-11-26-picks-semanales-design.md`

## Global Constraints

- Lenguaje del Excel: español sencillo, sin jerga (nada de "log-loss", "Kelly", "overround", "λ").
- Ventanas: archivo **lunes** = partidos lunes→jueves; archivo **jueves** = viernes→domingo (hora Colombia, America/Bogota).
- Filtro de picks: cuota de referencia **1.20–1.60**, prob final **≥ 0.70**, máx **10** picks, máx **2 por partido**.
- Tope del ajuste forma/rachas en mercados con precio: **±0.06** (6 puntos) respecto a la prob. de mercado.
- Pesos de forma: **50 %** últimos 3 partidos, **30 %** partidos 4–8, **20 %** resto de la temporada.
- Rachas: se activan con **≥ 5** partidos seguidos y saturan hacia **10+**.
- Cuota de referencia sin precio en datos: `1 / (p × 1.075)`. "No apuestes si tu casa paga menos de" = `1 / p`.
- Stake (fórmula Excel): `MAX(500, 0.05*Saldo/(Cuota-1))`; aviso rojo si stake > 25 % del saldo; sin recomendaciones si saldo < 500.
- Saldo por defecto: el de "Mis apuestas" del archivo anterior; si no hay, **2200**.
- Tarjetas: cada tarjeta (amarilla o roja) cuenta **1**.
- Nombre del archivo: `Apuestas_AAAA-MM-DD_(lunes|jueves).xlsx`, carpeta de Drive **"Apuestas Claude"**.

## Review Focus

- Sin partidos publicados en la ventana → el Excel se genera igual con la nota "aún no hay cuotas de los partidos de esta ventana" y hoja de historial intacta (Task 5, Task 6).
- Equipo recién ascendido / con < 3 partidos en la temporada → forma usa lo disponible sin dividir por cero; nunca NaN en el Excel (Task 2).
- Archivo anterior ausente o sin la hoja "Mis apuestas" / celdas vacías o con texto ("$500") → saldo 2200 y filas vacías ignoradas, sin romper (Task 6).
- Nombres de equipo distintos entre `fixtures.csv` y la historia (p. ej. espacios al final como "Liga Profesional ") → se normalizan con `trim`; partido sin historia sale solo con mercado (Task 4).
- Pick cuyo partido se aplazó / sin resultado tras 7 días → queda "pendiente", no "perdida" (Task 5).

---

### Task 1: Ajuste de goles al mercado

**Files:**
- Create: `src/picks/marketFit.ts`
- Test: `tests/picks.test.ts`

**Interfaces:**
- Produces: `fitLambdasToMarket(p: { home: number; draw: number; away: number; over25?: number }): { lh: number; la: number }` y `scoreMatrix(lh: number, la: number, maxGoals = 10): number[][]` (Poisson independiente, normalizada a 1). Reusa `fairProbs` de `src/core/betting.ts` para quitar margen antes de llamar.

- [ ] **Step 1: Tests**: `fitLambdasToMarket` recupera λ: genera p de `scoreMatrix(1.8, 0.9)` y exige `|lh−1.8|<0.05 && |la−0.9|<0.05`; sin `over25` ajusta solo con 1X2 (supremacía) y total = 2.6 por defecto; con mercado 1X2 = (0.17, 0.25, 0.58) y over25 = 0.45 devuelve `la > lh`.
- [ ] **Step 2:** `npx tsx --test tests/picks.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3:** Implementar: minimizar error cuadrático entre (pH, pA, pOver) del modelo y del mercado con búsqueda en malla gruesa (0.2–4.0, paso 0.05) + refinamiento local (paso 0.005).
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** `git commit -m "picks: ajuste de goles esperados al mercado"`

### Task 2: Historias por equipo, forma y rachas

**Files:**
- Create: `src/picks/teamForm.ts`
- Test: `tests/picks.test.ts`

**Interfaces:**
- Produces:
  - `type TeamGame = { date: Date; home: boolean; gf: number; ga: number; xgf?: number; xga?: number; cf?: number; ca?: number; cardsFor?: number; cardsAgainst?: number; ref?: string }`
  - `teamGames(rows: Record<string,string>[], team: string, before: Date): TeamGame[]` (más reciente primero; solo temporada actual + anterior para rachas; columnas FTHG/FTAG|HG/AG, HxG/AxG, HC/AC, HY+HR/AY+AR, Referee).
  - `weightedMean(values: number[]): number` con pesos 0.5 (idx 0–2), 0.3 (3–7), 0.2 (resto), renormalizados a los existentes; `[]` → `NaN` controlado por el llamador.
  - `type StreakKind = 'gana' | 'noPierde' | 'pierde' | 'marca' | 'recibe' | 'sinRecibir' | 'over25' | 'under25' | 'ambos'`
  - `streaks(games: TeamGame[]): Record<StreakKind, number>`
  - `streakWeight(len: number): number` → 0 si `< 5`; crece hasta ~1 en `≥ 10` (p. ej. `min(1, (len-4)/6)`).
- [ ] **Step 1: Tests**: `weightedMean([3,3,3,0,0,0,0,0,0,0])` ≈ 0.5·3 + 0.3·0 + 0.2·0 = 1.5; `streaks` sobre 6 victorias seguidas → `gana=6, noPierde=6`; `streakWeight(4)=0`, `streakWeight(10)=1`, `streakWeight(15)=1`; equipo con 1 partido → `weightedMean` usa solo ese valor; `teamGames` ignora filas sin goles.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "picks: forma reciente y rachas por equipo"`

### Task 3: Candidatas por partido (todas las apuestas)

**Files:**
- Create: `src/picks/candidates.ts`, `src/picks/counts.ts`
- Test: `tests/picks.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces:
  - `nbOverProb(mu: number, r: number, line: number): number` (binomial negativa; `r ≥ 1e6` ≈ Poisson) en `counts.ts`.
  - `type Candidate = { matchId: string; league: string; date: string; home: string; away: string; key: string; label: string; market: 'Ganador'|'Doble oportunidad'|'Goles'|'Ambos marcan'|'Goles de un equipo'|'Hándicap'|'Córners'|'Tarjetas'; prob: number; refOdds: number; minOdds: number; hasMarketPrice: boolean; confidence: 'alta'|'media'; reason: string }`
  - `buildCandidates(fx: FixtureInput, ctx: LeagueContext): Candidate[]` donde `FixtureInput = { league: string; date: Date; home: string; away: string; odds?: { home?: number; draw?: number; away?: number; over25?: number; under25?: number } }` y `LeagueContext = { rows: Record<string,string>[]; cornersR: number; cardsR: number; refCards?: Record<string, number> }`.
- Reglas:
  - λ base = `fitLambdasToMarket` (cuotas BFE si existen, si no Avg). Sin cuotas → `fitModel` del repo con `halfLifeDays: 120` y `hasMarketPrice=false` para todo.
  - Ajuste: λ × (1 + 0.15·(forma ataque propio/media liga − 1) + 0.1·streakWeight) acotado; después cada prob de mercado con precio se recorta a `[pMercado − 0.06, pMercado + 0.06]`.
  - Mercados: Gana local/visita, Doble oportunidad (1X, X2, 12), Más/Menos 0.5–4.5, Ambos marcan Sí/No, Goles de cada equipo Más 0.5/1.5, Hándicap −1.5/+1.5, Córners más/menos 7.5–11.5, Tarjetas más/menos 2.5–5.5 (córners/tarjetas solo si la liga tiene HC/HY).
  - Tarjetas: media del árbitro (si `Referee` existe y tiene ≥ 5 partidos) mezclada 50/50 con la media por equipos.
  - `refOdds`: cuota del mercado si es 1X2 u over/under 2.5 con precio; si no, `1/(p×1.075)`. `minOdds = 1/p`.
  - `label` en lenguaje simple ("Gana el Inter", "Habrá 3 goles o más", "El Getafe no pierde", "9 córners o más"); `reason` 1 línea con la racha o forma más fuerte que respalda la apuesta (o "Las casas lo dan como muy probable" si no hay racha).
- [ ] **Step 1: Tests**: con mercado (1.65, 3.85, 5.75) los `prob` de 1X2 quedan a ≤ 0.06 de `fairProbs`; `nbOverProb(9.5, 1e7, 9.5)` ≈ Poisson(9.5) P(X≥10) (±0.005); sin odds → todos `hasMarketPrice=false`; no hay `NaN` en ninguna `prob/refOdds` para un equipo con 1 partido; `label` nunca contiene "λ", "Kelly" ni "overround".
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "picks: candidatas de todos los mercados con forma y rachas"`

### Task 4: Selección y CLI de picks

**Files:**
- Create: `src/picks/select.ts`, `scripts/picks.ts`, `scripts/descargar_datos.sh`
- Test: `tests/picks.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `choosePicks(c: Candidate[], o = { minOdds: 1.2, maxOdds: 1.6, minProb: 0.7, max: 10, perMatch: 2 }): Candidate[]` orden por `prob` desc, desempate `prob − 1/refOdds`, prioriza mercados distintos.
  - `windowFor(kind: 'lunes'|'jueves', today: Date): { from: Date; to: Date }` en America/Bogota (lunes→jueves 23:59; viernes→domingo 23:59).
  - CLI: `npx tsx scripts/picks.ts --ventana lunes|jueves --fecha YYYY-MM-DD --datos DIR --historial picks/historial.json --salida salida/picks.json`. Escribe `{ generado, ventana, nota?, picks: Candidate[], historial: HistEntry[] }`.
  - `descargar_datos.sh DIR`: baja con `curl -fsSL` todos los assets de `https://github.com/JuanDaAstronmy/analizador-apuestas/releases/download/datos/` listados por `gh`-free: usa la lista fija del workflow (Task 7) más `fixtures.csv` y `new_league_fixtures.csv`; nombres de equipo `trim()` al leer.
- [ ] **Step 1: Tests**: `choosePicks` descarta cuota 1.15 y 1.70 y prob 0.69; nunca más de 2 por `matchId`; máx 10; `windowFor('jueves', 2026-11-26)` = 27-nov 00:00 → 29-nov 23:59 (Bogotá); `windowFor('lunes', 2026-11-30)` = 30-nov → 3-dic.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Corrida real: `bash scripts/descargar_datos.sh /tmp/d && npx tsx scripts/picks.ts --ventana jueves --fecha 2026-11-26 --datos /tmp/d --historial picks/historial.json --salida salida/picks.json` → JSON con picks o `nota` si no hay partidos; revisar a ojo 3 picks (cuotas razonables, razón coherente).
- [ ] **Step 6:** `git commit -m "picks: selección, ventanas y CLI"`

### Task 5: Historial y liquidación

**Files:**
- Create: `src/picks/settle.ts`, `picks/historial.json` (inicial `[]`)
- Modify: `scripts/picks.ts` (agregar picks nuevos al historial y liquidar pendientes)
- Test: `tests/picks.test.ts`

**Interfaces:**
- Produces: `type HistEntry = Candidate & { archivo: string; resultado: 'pendiente'|'ganada'|'perdida'; marcador?: string }` y `settle(e: HistEntry, rows: Record<string,string>[], now: Date): HistEntry`.
- [ ] **Step 1: Tests**: "Habrá 3 goles o más" con 2-1 → ganada; "9 córners o más" con HC+AC = 8 → perdida; "Tarjetas más de 3.5" con HY+HR+AY+AR = 4 → ganada (cada tarjeta 1); sin fila de resultado y 10 días después → sigue `pendiente`; picks ya liquidados no cambian; mismo pick no se duplica si se corre dos veces el mismo día.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "picks: historial y liquidación automática"`

### Task 6: Excel con fórmulas y gráficas

**Files:**
- Create: `scripts/build_xlsx.py`, `tests/test_build_xlsx.py`, `requirements.txt` (`openpyxl==3.1.5`)

**Interfaces:**
- Consumes: `salida/picks.json` (Task 4/5).
- Produces: `python3 scripts/build_xlsx.py --picks salida/picks.json [--anterior Apuestas_previo.xlsx] --salida salida/Apuestas_2026-11-26_jueves.xlsx`.
- Hojas y contenido según la sección 6 del spec: "Apuestas de hoy" (celda `B2` = Mi saldo; columnas: fecha/hora, liga, partido, apuesta, cuota ref., no apuestes si paga menos de, probabilidad "8 de cada 10", cuánto apostar `=MAX(500,0.05*$B$2/(F-1))`, ganas, pierdes, por qué; formato condicional rojo si stake > 0.25·B2; verde/amarillo/gris por prob ≥0.85/≥0.78/resto; si `B2 < 500` mensaje "Con menos de $500 no se puede apostar"), "Cómo usar" (6–8 líneas), "Mis apuestas" (preguntas: ¿Cuál apostaste? con validación de lista, ¿En qué casa?, ¿Cuánto apostaste?, ¿Qué cuota te dieron de verdad?, ¿Ganó? (Sí/No/Devuelta), ¿Por qué la elegiste?; columnas calculadas ganancia, saldo, ganancia esperada; resumen Claude vs "idea mía"; gráfica de líneas saldo real / esperado / meta), "Historial" (tabla + resumen: aciertos, % de acierto y saldo simulado con la regla del 5 % desde 2200 + gráfica aciertos reales vs esperados).
- Lectura del anterior: copia filas no vacías de "Mis apuestas"; saldo por defecto = último saldo calculado; valores con "$" o puntos de miles se limpian; si falta archivo/hoja → 2200 y tabla vacía. "¿Ganó?" se prellena desde el historial cuando la fila referencia un pick liquidado y la celda está vacía.
- [ ] **Step 1: Tests (pytest o unittest)**: sin `--anterior` → `B2 == 2200`; con anterior que tiene 2 filas en "Mis apuestas" → nuevas filas = 2 y saldo por defecto = el calculado; celda "$500" se lee como 500; picks vacíos + nota → hoja con la nota y sin error; el libro tiene 4 hojas con esos nombres y 2 gráficas (`len(ws._charts)`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Generar con los picks reales de Task 4 y revisar el archivo (abrir con openpyxl, recalcular a mano 1 stake).
- [ ] **Step 6:** `git commit -m "excel: hojas, fórmulas y gráficas"`

### Task 7: Datos diarios y más ligas

**Files:**
- Modify: `.github/workflows/datos.yml`

- [ ] **Step 1:** cron a diario `'23 11 * * *'`; agregar ligas principales `B1 G1 SC0 D2 F2 I2 SP2` al bucle de temporadas y nuevas `AUT DNK FIN IRL JPN NOR POL ROU SWE SWZ CHN` a `new/`.
- [ ] **Step 2:** Push y verificar la corrida con `mcp__github__actions_list` (conclusión `success`) y que `new_JPN.csv` exista en la release.
- [ ] **Step 3:** Actualizar la lista de `descargar_datos.sh` (Task 4) para que coincida. Commit `"datos: actualización diaria y más ligas"`.

### Task 8: Tarea programada y primera entrega

**Files:**
- Create: `docs/TAREA_PROGRAMADA.md` (texto exacto del prompt de la tarea)

- [ ] **Step 1:** Escribir el prompt: clonar/actualizar repo; `npm ci`; `pip install -r requirements.txt`; detectar ventana por el día (lunes/jueves, Bogotá); buscar en Drive carpeta "Apuestas Claude" (crearla si no existe) y descargar el .xlsx más reciente; `descargar_datos.sh`; `picks.ts`; `build_xlsx.py --anterior`; revisión de sanidad (picks con cuotas 1.20–1.60, sin NaN, nombres legibles); subir a Drive; commit+push de `picks/historial.json`; terminar con un resumen de 3 líneas en español.
- [ ] **Step 2:** Primera entrega manual siguiendo ese prompt (ventana jueves de hoy) y subir el archivo a Drive; mostrarle al usuario el resultado.
- [ ] **Step 3:** Crear la tarea con `create_trigger`: `cron_expression: "CRON_TZ=America/Bogota 13 7 * * 1,4"`, `create_new_session_on_fire: true`, `connectors: ["Google Drive"]`, prompt = contenido de `docs/TAREA_PROGRAMADA.md`. Confirmar `next_run_at`.
- [ ] **Step 4:** Commit `"tarea programada: instrucciones"` y push.
