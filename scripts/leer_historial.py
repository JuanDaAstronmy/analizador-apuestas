"""Imprime en JSON el historial guardado dentro de un Excel anterior ([] si no existe).
Uso: python3 scripts/leer_historial.py Apuestas_previo.xlsx > historial.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_xlsx import read_history  # noqa: E402

print(json.dumps(read_history(sys.argv[1] if len(sys.argv) > 1 else None), ensure_ascii=False))
