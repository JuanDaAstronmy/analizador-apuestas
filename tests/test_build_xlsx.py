"""Pruebas del generador del Excel. Ejecutar: python3 -m unittest tests/test_build_xlsx.py"""
import json, os, shutil, subprocess, sys, tempfile, unittest
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
        cmd += ['--anterior'] + (anterior if isinstance(anterior, list) else [anterior])
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

    def test_historial_viaja_dentro_del_excel(self):
        hist = [dict(PICK, archivo='a.xlsx', resultado='ganada', marcador='2-1', reason='x' * 40000)]
        with tempfile.TemporaryDirectory() as d:
            _, out = build(d, write_picks(d, [PICK], historial=hist))
            self.assertEqual(build_xlsx.read_history(out), hist)
            self.assertEqual(build_xlsx.read_history(os.path.join(d, 'no-existe.xlsx')), [])
            r = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'leer_historial.py'), out], capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(r.stdout), hist)

    def test_columnas_distinguen_cuota_real_estimada_y_sin_cuota(self):
        media = dict(PICK, key='CORN:8.5:over', label='Habrá 9 córners o más', market='Córners', confidence='media',
                     prob=0.8, refOdds=1.16, minOdds=1.25, hasMarketPrice=False)
        real = dict(PICK, key='1X2:1', label='Gana el Leeds', confidence='alta', prob=0.8, refOdds=1.3, minOdds=1.25, hasMarketPrice=True)
        with tempfile.TemporaryDirectory() as d:
            wb, _ = build(d, write_picks(d, [real, media]))
            ws = wb['Apuestas de hoy']
            self.assertEqual(ws['G6'].value, 'Cuota esperada en tu casa')
            self.assertEqual(ws['H6'].value, 'Apuesta solo si tu casa paga al menos')
            self.assertEqual(ws['J6'].value, 'Confianza')
            self.assertEqual(ws['G7'].value, 1.3)
            self.assertIn('real', ws['J7'].value)
            self.assertEqual(ws['G8'].value, '—')
            self.assertEqual(ws['H8'].value, 1.25)
            self.assertIn('sin cuota', ws['J8'].value)
            self.assertIn('H8', ws['K8'].value)  # el stake se calcula con la cuota mínima

    def test_varios_archivos_anteriores_se_combinan(self):
        with tempfile.TemporaryDirectory() as d:
            h1 = [dict(PICK, archivo='a', resultado='pendiente')]
            h2 = [dict(PICK, archivo='a', resultado='ganada', marcador='2-0'), dict(PICK, key='BTTS:yes', archivo='b', resultado='pendiente')]
            _, f1 = build(d, write_picks(d, [PICK], historial=h1), name='a.xlsx')
            _, f2 = build(d, write_picks(d, [PICK], historial=h2), name='b.xlsx')
            for f, txt, day in ((f1, 'nota vieja', '27/11'), (f2, 'nota nueva', '30/11')):
                wb = load_workbook(f); ws = wb['Mis apuestas']
                ws.cell(build_xlsx.FIRST_ROW, 1, day); ws.cell(build_xlsx.FIRST_ROW, 2, 'Otra (idea mía)'); ws.cell(build_xlsx.FIRST_ROW, 5, 500); ws.cell(build_xlsx.FIRST_ROW, 8, txt)
                wb.save(f)
            hist = build_xlsx.read_history([f1, f2])
            self.assertEqual(len(hist), 2)
            self.assertEqual([h['resultado'] for h in hist if h['key'] == PICK['key']], ['ganada'])
            wb3, _ = build(d, write_picks(d, [PICK]), anterior=[f1, f2], name='c.xlsx')
            notes = [wb3['Mis apuestas'].cell(build_xlsx.FIRST_ROW + i, 8).value for i in range(3)]
            self.assertEqual(notes[:2], ['nota vieja', 'nota nueva'])
            self.assertIsNone(notes[2])

    def test_fila_corregida_en_el_nuevo_no_se_duplica(self):
        with tempfile.TemporaryDirectory() as d:
            files = []
            for name, gano in (('viejo.xlsx', None), ('nuevo.xlsx', 'Sí')):
                _, f = build(d, write_picks(d, [PICK]), name=name)
                wb = load_workbook(f); ws = wb['Mis apuestas']; r = build_xlsx.FIRST_ROW
                ws.cell(r, 1, '28/11'); ws.cell(r, 2, 'Otra (idea mía)'); ws.cell(r, 4, 'BetPlay'); ws.cell(r, 5, 500); ws.cell(r, 6, 1.4)
                if gano:
                    ws.cell(r, 7, gano)
                wb.save(f); files.append(f)
            _, rows = build_xlsx.read_previous(files)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['gano'], 'Sí')

    @unittest.skipUnless(shutil.which('soffice'), 'LibreOffice no disponible')
    def test_formulas_ganada_sin_cuota_e_idea_mia(self):
        with tempfile.TemporaryDirectory() as d:
            _, out = build(d, write_picks(d, [PICK]))
            wb = load_workbook(out); ws = wb['Mis apuestas']; r = build_xlsx.FIRST_ROW
            ws.cell(r, 2, 'Otra (idea mía)'); ws.cell(r, 5, 500); ws.cell(r, 7, 'Sí')  # ganó pero no anotó la cuota
            wb.save(out)
            subprocess.run(['soffice', '--headless', '--convert-to', 'xlsx', '--outdir', os.path.join(d, 'calc'), out], check=True, capture_output=True, timeout=120)
            calc = load_workbook(os.path.join(d, 'calc', os.path.basename(out)), data_only=True)['Mis apuestas']
            self.assertIn(calc.cell(r, 10).value, (None, ''))  # ganancia: vacía, no -500
            self.assertIn(calc.cell(r, 9).value, (None, ''))   # probabilidad de una idea propia: vacía, no 0

    def test_lectura_de_plata_y_cuotas(self):
        self.assertEqual(build_xlsx.parse_money('$2.200'), 2200)
        self.assertEqual(build_xlsx.parse_money('500'), 500)
        self.assertEqual(build_xlsx.parse_money('20,000'), 20000)
        self.assertEqual(build_xlsx.parse_money('$ 1.250.000'), 1250000)
        self.assertEqual(build_xlsx.parse_money(''), None)
        self.assertAlmostEqual(build_xlsx.parse_odds('1,85'), 1.85)
        self.assertEqual(build_xlsx.parse_odds('hola'), None)

    def test_simulacion_historial_regla_5(self):
        h = [dict(PICK, resultado='ganada', refOdds=1.25), dict(PICK, resultado='perdida', refOdds=1.25), dict(PICK, resultado='pendiente')]
        # gana: apuesta max(500, 110/0.25=440)=500 → +125 = 2325; pierde: max(500, 116.25/0.25=465)=500 → 1825
        self.assertEqual(round(build_xlsx.simulate_rule(h, 2200)), 1825)


if __name__ == '__main__':
    unittest.main()
