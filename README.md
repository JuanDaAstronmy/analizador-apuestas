# Analizador de apuestas deportivas (fútbol)

App móvil (Expo / React Native) **predictiva y de análisis**: no recibe ni mueve dinero.
Estima probabilidades a partir de datos históricos, las compara con las cuotas que ves en tu casa de
apuestas (p. ej. BetPlay) y te dice qué apuestas tienen valor, cuánto apostar con un perfil
conservador y cómo usar mejor una apuesta gratis. Además lleva la bitácora de tus apuestas y aplica límites de pérdida.

## Cómo abrirla en el celular

1. Instala **Expo Go** en el celular (Play Store / App Store).
2. En el computador, dentro de esta carpeta:
   ```bash
   npm install
   npx expo start
   ```
3. Escanea el código QR con Expo Go (el celular y el computador deben estar en la misma red Wi-Fi).

Todas las librerías nativas que usa (AsyncStorage, SVG, safe-area) vienen incluidas en Expo Go, así
que no hace falta compilar nada.

### Generar un APK (instalar sin computador)

El APK se compila gratis en los servidores de Expo (EAS Build), no en tu computador:

```bash
npm install
npx eas-cli@latest login                                 # cuenta gratis en expo.dev
npx eas-cli@latest build -p android --profile preview   # la primera vez: responde "Y" a todo
```

Tarda unos 10–20 minutos. Al terminar muestra un enlace y un código QR: ábrelo en el celular,
descarga el `.apk` e instálalo (Android pedirá permitir "instalar apps de origen desconocido").

## Pestañas

| Pestaña | Qué hace |
|---|---|
| ⚽ **Partidos** | Elige liga y descarga los datos. Muestra los próximos partidos con la probabilidad 1/X/2 del modelo. También puedes analizar cualquier cruce de equipos. |
| 📊 **Analizar** | Goles esperados, marcadores más probables y probabilidades de 18 selecciones: 1X2, doble oportunidad, empate no apuesta, más/menos 0.5–3.5 goles y ambos marcan. Escribes las cuotas de BetPlay y la app ordena las apuestas: **recomendada**, **fuera de perfil** (tiene valor pero es arriesgada) o **sin valor**. |
| 🎁 **Bono** | Optimizador de apuesta gratis con cuota mínima (por defecto 2.2): opciones simples y combinadas de 2 partidos, ordenadas por *probabilidad de cobrar* o por *valor esperado*. |
| 📒 **Bitácora** | Registro de apuestas, bankroll, ROI, curva, caída máxima, ganancia esperada contra la real, CLV y límites de riesgo. |
| ⚙️ **Modelo** | Bankroll, perfil de riesgo, confianza en el modelo, **backtest** con datos reales, **simulador Monte Carlo** y fuerza de los equipos. |

## Matemática (lo que hay detrás)

- **Modelo Dixon-Coles** (Poisson bivariado): `goles_local ~ Poisson(γ·α_local·β_visit)`,
  `goles_visit ~ Poisson(α_visit·β_local)`, más la corrección τ(ρ) para marcadores bajos. Se ajusta por
  máxima verosimilitud **ponderada en el tiempo** (vida media de 365 días) con iteración de punto
  fijo, y regularización por "partidos ficticios" que encoge hacia el promedio a los equipos con pocos
  datos. A los recién ascendidos los encoge hacia el cuartil débil de la liga. ρ se elige por búsqueda en malla. Ver `src/core/model.ts`.
- **Probabilidad ajustada**: `p = w·p_modelo + (1−w)·p_mercado`, con `w` = confianza en el modelo
  (por defecto 35 %). La probabilidad del mercado se obtiene quitándole el margen a las cuotas.
- **Valor esperado**: `EV = p_gana·(cuota−1) − p_pierde`.
- **Criterio de Kelly** (con devolución): `f* = (p_g·b − p_p) / (b·(p_g+p_p))`. Se usa **¼ de Kelly**
  con tope del 2 % del bankroll (perfil conservador). Las apuestas se ordenan por **crecimiento
  logarítmico esperado** del bankroll, que es justamente "crecimiento a largo plazo".
- **Apuesta gratis** (stake no devuelto): `valor esperado = p·(cuota−1)·bono`.
- **Backtest walk-forward**: semana a semana, ajusta el modelo solo con el pasado, predice los partidos
  siguientes y simula las reglas de apuesta con las cuotas de cierre. Mide log-loss, Brier y calibración.
- **Monte Carlo**: 3.000 trayectorias de bankroll para ver percentiles, probabilidad de terminar perdiendo y caídas.

### Perfiles de riesgo

| | Conservador | Moderado |
|---|---|---|
| Prob. mínima de no perder | 50 % | 40 % |
| Cuota máxima | 2.10 | 3.00 |
| Ventaja mínima (EV) | +3 % | +2 % |
| Fracción de Kelly | ¼ | ⅓ |
| Máx. por apuesta | 2 % | 3 % |
| Máx. pendiente a la vez | 6 % | 10 % |
| Pérdida diaria máx. | 5 % | 8 % |
| Pausa por caída desde el máximo | 20 % | 30 % |

## Resultados honestos del backtest (nov-2026)

Últimos ~4 años de cada liga, perfil conservador, confianza en el modelo de 35 %, contra cuotas de **cierre**
(Pinnacle o el promedio del mercado). Log-loss 1X2: menor es mejor.

| Liga | Partidos predichos | Log-loss modelo | Log-loss mercado | Apuestas | ROI |
|---|---|---|---|---|---|
| Premier League | 1250 | 0.988 | **0.965** | 145 | −8.5 % |
| LaLiga | 1256 | 0.983 | **0.957** | 162 | −2.3 % |
| Argentina | 1934 | 1.068 | **1.049** | 31 | −8.1 % |
| Brasil | 1259 | 1.019 | **0.987** | 24 | −6.1 % |
| México | 1125 | 1.009 | **0.986** | 24 | +21.6 % (muestra muy pequeña) |

**Conclusión:** el modelo está bien calibrado, pero en ninguna liga predice mejor que las cuotas de
cierre del mercado. Por eso la app mezcla las dos probabilidades y es exigente para recomendar una apuesta. Lo
realista es usarla para:
1. **Evitar malas apuestas**: cuotas por debajo de la "cuota justa".
2. **Gestionar el bankroll** con disciplina: stakes pequeños, límites y pausas.
3. **Sacarle el máximo a los bonos** (ahí sí hay valor esperado positivo garantizado, porque no arriesgas plata propia).
4. **Medir de verdad** si tienes ventaja: la bitácora compara la ganancia esperada con la real y calcula el CLV.

Para repetir el backtest desde la terminal con CSV descargados:
```bash
npm run backtest -- --perfil conservador --peso 0.35 E0_2425.csv E0_2526.csv E0_2627.csv
```

## Datos

- **football-data.co.uk**: gratis y sin API key. Trae resultados y cuotas de cierre de las 9 ligas
  europeas incluidas y de Argentina, Brasil, México y la MLS. Los próximos partidos salen de `fixtures.csv`, que
  se publica pocos días antes de cada jornada.
- **Copia en GitHub:** football-data.co.uk está bloqueado en algunas redes de Colombia. El workflow
  `.github/workflows/datos.yml` copia los CSV a la release `datos` de este repositorio todos los días
  (o cuando lo corres a mano en la pestaña *Actions → Actualizar datos → Run workflow*).
  La app descarga primero esa copia y, si falla, va al sitio original.
- **La Liga BetPlay (Colombia) no está en esa fuente.** Opciones para agregarla: API-Football
  (api-sports.io, plan gratis de 100 consultas/día con API key) o cargar un CSV propio.
- **Sofascore** no tiene una API pública oficial y no licencia sus datos, así que no se usa.

## Pruebas

```bash
npm test          # 11 pruebas del núcleo (modelo, mercados, Kelly, bono, bitácora, backtest, Monte Carlo)
npm run typecheck
```

## Estructura

```
src/core/     lógica pura en TypeScript (sin React): model, markets, betting, freebet, bankroll, backtest, montecarlo
src/data/     catálogo de ligas y descarga de CSV
src/ui/       estado (store), componentes y pantallas
tests/        pruebas con node:test
scripts/      backtest por línea de comandos
```

## Juego responsable

Ningún modelo garantiza ganancias. Apuesta solo dinero que puedas perder, no persigas pérdidas y respeta las pausas que marca la app.
