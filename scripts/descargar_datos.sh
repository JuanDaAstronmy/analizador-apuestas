#!/usr/bin/env bash
# Descarga a DIR la copia de los CSV de football-data.co.uk publicada en la release "datos".
# Uso: bash scripts/descargar_datos.sh DIR
set -u
DIR=${1:?Uso: descargar_datos.sh DIR}
BASE=https://github.com/JuanDaAstronmy/analizador-apuestas/releases/download/datos
mkdir -p "$DIR"
y=$(date -u +%Y); m=$(date -u +%-m)
if [ "$m" -ge 7 ]; then start=$y; else start=$((y-1)); fi
ok=0
# Primero el sitio original (lo más fresco: los partidos se publican ~4 am hora Colombia); si está bloqueado, la copia en GitHub.
get() {
  local path=${1//_//}
  case "$1" in mmz4281_*) path="mmz4281/$(echo "$1" | cut -d_ -f2)/$(echo "$1" | cut -d_ -f3)";; new_league_fixtures.csv) path="$1";; esac
  if curl -fsL --retry 2 --max-time 60 -o "$DIR/$1" "https://football-data.co.uk/$path" && head -c 20 "$DIR/$1" | grep -q ','; then ok=$((ok+1));
  elif curl -fsL --retry 3 --max-time 120 -o "$DIR/$1" "$BASE/$1"; then ok=$((ok+1)); else rm -f "$DIR/$1"; fi
}
for i in 0 1 2; do
  s=$(printf '%02d%02d' $(( (start-i) % 100 )) $(( (start-i+1) % 100 )))
  for lg in E0 E1 SP1 SP2 I1 I2 D1 D2 F1 F2 N1 P1 B1 G1 T1 SC0; do get "mmz4281_${s}_${lg}.csv"; done
done
for lg in ARG BRA MEX USA AUT DNK FIN IRL JPN NOR POL ROU SWE SWZ CHN; do get "new_${lg}.csv"; done
get fixtures.csv
get new_league_fixtures.csv
echo "Archivos descargados: $ok"
[ "$ok" -ge 10 ]
