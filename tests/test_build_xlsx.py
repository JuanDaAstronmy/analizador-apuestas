"""Pruebas del generador del Excel. Ejecutar: python3 -m unittest tests/test_build_xlsx.py"""
import json, os, subprocess, sys, tempfile, unittest
from openpyxl import load_workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'build_xlsx.py')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import build_xlsx  # noqa: E402

PICK = {
    'matchId': 'E0|Leeds|Hull|2026-11-28', 'league': 'E0', 'leagueName': 'Premier League (Inglaterra)',
    'date': '2026-11-28T15:00:00.000Z', 'home': 'Leeds', 'away': 'Hull', 'key': 'OU:1.5:over',
    'label': 'Habrá 2 goles o más en el partido', 'market': 'Goles', 'prob': 0.8, 'refOdds': 1.25,
    'minOdds': 1.25, 'hasMarketPrice': False, 'confidence': 'alta', 'reason': 'Las casas lo ven muy probable',
}


def write_picks(d, picks, nota=None, historial=None):
    p = os.path.join(d, 'picks.json')
    with open(p, 'w') as f:
        json.dump({'ventana': 'viernes', 'desde': '2026-11-27T05:00:00Z', 'hasta': '2026-12-01T04:59:59Z',
                   'archivo': 'x.xlsx', 'partidos': len(picks), 'nota': nota, 'picks': picks,
                   'historial': historial if historial is not None else [dict(PICK, archivo='x.xlsx', resultado='pendiente')]}, f)
    return p


def build(d, picks_path, anterior=None, name='out.xlsx'):
    out = os.path.join(d, name)
    cmd = [sys.executable, SCRIPT, '--picks', picks_path, '--salida', out]
    if anterior:
        cmd += ['--anterior', anterior]
    subprocess.run(cmd, check=True, capture_output=True)
    return load_workbook(out), out


class TestBuildXlsx(unittest.TestCase):
    def test_sin_anterior_saldo_por_defecto_y_hojas(self):
        with tempfile.TemporaryDirectory() as d:
            wb, _ = build(d, write_picks(d, [PICK]))
            self.assertEqual([w.title for w in wb.worksheets if w.sheet_state == 'visible'], ['Apuestas de hoy', 'Cómo usar', 'Mis apuestas', 'Historial'])
            self.assertEqual(wb['Apuestas de hoy']['B2'].value, 2200)
            self.assertEqual(len(wb['Mis apuestas']._charts), 1)
            self.assertEqual(len(wb['Historial']._charts), 1)
            self.assertTrue(wb['Apuestas de hoy']['B7'].value.startswith('sáb 28/11'))

    def test_arrastra_mis_apuestas_y_calcula_saldo(self):
        with tempfile.TemporaryDirectory() as d:
            _, prev = build(d, write_picks(d, [PICK]), name='prev.xlsx')
            wb = load_workbook(prev)
            ws = wb['Mis apuestas']
            r = build_xlsx.FIRST_ROW
            ws.cell(r, 2, 'Otra (idea mía)'); ws.cell(r, 5, '$500'); ws.cell(r, 6, '1,30'); ws.cell(r, 7, 'Sí')
            ws.cell(r + 1, 2, 'Otra (idea mía)'); ws.cell(r + 1, 5, 500); ws.cell(r + 1, 6, 1.5); ws.cell(r + 1, 7, 'No')
            wb.save(prev)
            wb2, _ = build(d, write_picks(d, [PICK]), anterior=prev)
            ws2 = wb2['Mis apuestas']
            self.assertEqual(ws2.cell(r, 5).value, 500)
            self.assertEqual(ws2.cell(r + 1, 7).value, 'No')
            self.assertIsNone(ws2.cell(r + 2, 5).value)
            # 2200 + 500*0.30 - 500 = 1850
            self.assertEqual(wb2['Apuestas de hoy']['B2'].value, 1850)

    def test_sin_picks_muestra_la_nota(self):
        with tempfile.TemporaryDirectory() as d:
            wb, _ = build(d, write_picks(d, [], nota='Todavía no hay cuotas publicadas'))
            texts = [c.value for row in wb['Apuestas de hoy'].iter_rows() for c in row if isinstance(c.value, str)]
            self.assertTrue(any('Todavía no hay cuotas publicadas' in t for t in texts))

    def test_anterior_inexistente_no_rompe(self):
        with tempfile.TemporaryDirectory() as d:
            wb, _ = build(d, write_picks(d, [PICK]), anterior=os.path.join(d, 'no-existe.xlsx'))
            self.assertEqual(wb['Apuestas de hoy']['B2'].value, 2200)

    def test_graficas_muestran_columnas_ocultas(self):
        import zipfile
        with tempfile.TemporaryDirectory() as d:
            _, out = build(d, write_picks(d, [PICK]))
            with zipfile.ZipFile(out) as z:
                charts = [z.read(n).decode() for n in z.namelist() if n.startswith('xl/charts/chart')]
            self.assertEqual(len(charts), 2)
            for xml in charts:
                self.assertIn('plotVisOnly val="0"', xml)

    def test_lectura_de_plata_y_cuotas(self):
        self.assertEqual(build_xlsx.parse_money('$2.200'), 2200)
        self.assertEqual(build_xlsx.parse_money('500'), 500)
        self.assertEqual(build_xlsx.parse_money(''), None)
        self.assertAlmostEqual(build_xlsx.parse_odds('1,85'), 1.85)
        self.assertEqual(build_xlsx.parse_odds('hola'), None)

    def test_simulacion_historial_regla_5(self):
        h = [dict(PICK, resultado='ganada', refOdds=1.25), dict(PICK, resultado='perdida', refOdds=1.25), dict(PICK, resultado='pendiente')]
        # gana: apuesta max(500, 110/0.25=440)=500 → +125 = 2325; pierde: max(500, 116.25/0.25=465)=500 → 1825
        self.assertEqual(round(build_xlsx.simulate_rule(h, 2200)), 1825)


if __name__ == '__main__':
    unittest.main()
