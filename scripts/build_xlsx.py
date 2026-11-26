"""Arma el Excel de apuestas recomendadas a partir de picks.json.

Uso: python3 scripts/build_xlsx.py --picks salida/picks.json [--anterior Apuestas_previo.xlsx] --salida salida/Apuestas.xlsx
"""
import argparse
import json
import os
import re
from datetime import datetime, timedelta, timezone

from openpyxl import Workbook, load_workbook
from openpyxl.chart import LineChart, Reference
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

SALDO_DEFECTO = 2200
MINIMO = 500
META = 0.05
FIRST_ROW = 7  # primera fila de datos en "Mis apuestas"
EMPTY_ROWS = 40  # filas vacías con fórmulas para que el usuario escriba
BOGOTA = timezone(timedelta(hours=-5))

VERDE = PatternFill('solid', fgColor='C6EFCE')
AMARILLO = PatternFill('solid', fgColor='FFEB9C')
GRIS = PatternFill('solid', fgColor='EDEDED')
ROJO = PatternFill('solid', fgColor='FFC7CE')
EDITABLE = PatternFill('solid', fgColor='FFF2CC')
ENCABEZADO = PatternFill('solid', fgColor='1F3864')
BLANCO = Font(color='FFFFFF', bold=True)
NEGRITA = Font(bold=True)
TITULO = Font(bold=True, size=14)
AJUSTE = Alignment(wrap_text=True, vertical='top')
OTRA = 'Otra (idea mía)'


# ---------- lectura de valores escritos por el usuario ----------

def parse_money(v):
    """'$2.200' → 2200; 500 → 500; vacío/texto → None (pesos colombianos, punto de miles)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace('$', '').replace(' ', '')
    if not s:
        return None
    if re.fullmatch(r'\d{1,3}(\.\d{3})+(,\d+)?', s):
        s = s.replace('.', '').replace(',', '.')
    else:
        s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def parse_odds(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        x = float(str(v).strip().replace(',', '.'))
        return x if x > 1 else None
    except ValueError:
        return None


def won_value(v):
    s = str(v or '').strip().lower()
    return {'sí': 'Sí', 'si': 'Sí', 'no': 'No', 'devuelta': 'Devuelta'}.get(s)


# ---------- utilidades ----------

def local_dt(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(BOGOTA)


DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']


def fecha_hora(iso):
    d = local_dt(iso)
    h = d.hour % 12 or 12
    return f"{DIAS[d.weekday()]} {d.strftime('%d/%m')} {h}:{d.strftime('%M')} {'am' if d.hour < 12 else 'pm'}"


def pick_text(p):
    return f"{p['home']} vs {p['away']} — {p['label']} ({local_dt(p['date']).strftime('%d/%m')})"


def veces(p):
    return f"{round(p * 10)} de cada 10"


def stake_rule(balance, odds):
    return min(balance, max(MINIMO, META * balance / (odds - 1)))


def simulate_rule(historial, start):
    """Saldo si se hubiera seguido cada recomendación liquidada con la regla del 5 % (mínimo $500)."""
    bal = start
    for h in sorted([x for x in historial if x.get('resultado') in ('ganada', 'perdida')], key=lambda x: x['date']):
        if bal < MINIMO:
            break
        s = stake_rule(bal, h['refOdds'])
        bal += s * (h['refOdds'] - 1) if h['resultado'] == 'ganada' else -s
    return bal


def read_previous(path):
    """Devuelve (saldo_inicial, filas) de la hoja 'Mis apuestas' del archivo anterior."""
    if not path or not os.path.exists(path):
        return SALDO_DEFECTO, []
    try:
        ws = load_workbook(path)['Mis apuestas']
    except Exception:
        return SALDO_DEFECTO, []
    start = parse_money(ws['B3'].value) or SALDO_DEFECTO
    rows = []
    for r in range(FIRST_ROW, ws.max_row + 1):
        vals = [ws.cell(r, c).value for c in range(1, 9)]
        if not any(v not in (None, '') for v in vals[1:8]):
            continue
        rows.append({
            'fecha': vals[0], 'cual': vals[1], 'detalle': vals[2], 'casa': vals[3],
            'cuanto': parse_money(vals[4]), 'cuota': parse_odds(vals[5]), 'gano': won_value(vals[6]), 'porque': vals[7],
        })
    return start, rows


def current_balance(start, rows):
    bal = start
    for r in rows:
        if r['cuanto'] and r['gano'] == 'Sí' and r['cuota']:
            bal += r['cuanto'] * (r['cuota'] - 1)
        elif r['cuanto'] and r['gano'] == 'No':
            bal -= r['cuanto']
    return round(bal)


def header(ws, row, titles, widths):
    for i, (t, w) in enumerate(zip(titles, widths), start=1):
        c = ws.cell(row, i, t)
        c.fill, c.font, c.alignment = ENCABEZADO, BLANCO, Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[get_column_letter(i)].width = w


# ---------- hojas ----------

def sheet_apuestas(ws, data, saldo):
    desde, hasta = local_dt(data['desde']), local_dt(data['hasta'])
    ws['A1'] = f"Apuestas recomendadas — partidos del {desde.strftime('%d/%m')} al {hasta.strftime('%d/%m')}"
    ws['A1'].font = TITULO
    ws['A2'], ws['B2'] = 'Mi saldo', saldo
    ws['B2'].fill, ws['B2'].font, ws['B2'].number_format = EDITABLE, NEGRITA, '$#,##0'
    ws['C2'], ws['D2'] = 'Meta por apuesta (5 %)', '=0.05*B2'
    ws['E2'], ws['F2'] = 'Apuesta mínima', MINIMO
    ws['D2'].number_format = ws['F2'].number_format = '$#,##0'
    ws['A3'] = '=IF(B2<500,"Con menos de $500 no se puede apostar.","Escribe tu saldo real en la celda amarilla y todo se recalcula.")'
    ws['A3'].font = Font(italic=True)
    if data.get('nota'):
        ws['A4'] = data['nota']
        ws['A4'].font = Font(bold=True, color='9C0006')
    cols = ['#', 'Fecha y hora (Colombia)', 'Liga', 'Partido', 'Apuesta', 'Tipo', 'Cuota de referencia',
            'No apuestes si tu casa paga menos de', '¿Qué tan probable?', 'Cuánto apostar', 'Ganas si sale',
            'Pierdes si falla', '¿Por qué?', 'Aviso']
    header(ws, 6, cols, [4, 16, 22, 28, 34, 16, 11, 14, 13, 12, 11, 11, 50, 24])
    for i, p in enumerate(data['picks'], start=1):
        r = 6 + i
        fill = VERDE if p['prob'] >= 0.85 else AMARILLO if p['prob'] >= 0.78 else GRIS
        vals = [i, fecha_hora(p['date']), p.get('leagueName', p['league']),
                f"{p['home']} vs {p['away']}", p['label'], p['market'], round(p['refOdds'], 2), round(p['minOdds'], 2),
                veces(p['prob']),
                f'=IF($B$2<{MINIMO},"—",ROUND(MIN($B$2,MAX({MINIMO},{META}*$B$2/(G{r}-1))),-1))',
                f'=IF(ISNUMBER(J{r}),ROUND(J{r}*(G{r}-1),-1),"")', f'=IF(ISNUMBER(J{r}),J{r},"")', p['reason'],
                f'=IF(AND(ISNUMBER(J{r}),J{r}>0.25*$B$2),"Esta apuesta es "&ROUND(J{r}/$B$2*100,0)&" % de tu saldo","")']
        for c, v in enumerate(vals, start=1):
            cell = ws.cell(r, c, v)
            cell.alignment = AJUSTE
            if c <= 9:
                cell.fill = fill
        for c in (10, 11, 12):
            ws.cell(r, c).number_format = '$#,##0'
    last = 6 + max(1, len(data['picks']))
    ws.conditional_formatting.add(f'J7:N{last}', FormulaRule(formula=['AND(ISNUMBER($J7),$J7>0.25*$B$2)'], fill=ROJO))
    ws.freeze_panes = 'A7'


def sheet_como_usar(ws):
    lines = [
        'Cómo usar este archivo',
        '1. Escribe tu saldo real en la celda amarilla de "Apuestas de hoy". Las apuestas se recalculan solas.',
        '2. Antes de apostar, busca la misma apuesta en BetPlay o Rushbet y mira la cuota. Si es menor que "No apuestes si tu casa paga menos de", no la hagas.',
        '3. Verde = las más seguras, amarillo = buenas, gris = alternativas. Ninguna es segura al 100 %.',
        '4. Haz una apuesta a la vez y espera el resultado antes de la siguiente.',
        '5. Si pierdes 2 seguidas, descansa hasta el próximo archivo.',
        '6. Después de apostar, anota en "Mis apuestas" cuánto apostaste, la cuota real y si ganó. Así vemos si el método funciona.',
        '7. Tipos de apuesta: "no pierde" = gana o empata. "Habrá 2 goles o más" = suma de los goles de los dos equipos. Córners y tarjetas cuentan las de los dos equipos (cada tarjeta, amarilla o roja, vale 1).',
        '8. Apuesta solo plata que puedas perder. Esto es un experimento, no una forma segura de ganar.',
    ]
    for i, t in enumerate(lines, start=1):
        c = ws.cell(i, 1, t)
        c.alignment = Alignment(wrap_text=True)
        if i == 1:
            c.font = TITULO
    ws.column_dimensions['A'].width = 110


def sheet_mis_apuestas(ws, wb, start, prev_rows, picks, historial):
    ws['A1'] = 'Mis apuestas — anota aquí lo que apostaste'
    ws['A1'].font = TITULO
    ws['A3'], ws['B3'] = 'Saldo con el que empezaste', start
    ws['B3'].fill, ws['B3'].number_format = EDITABLE, '$#,##0'
    end = FIRST_ROW + len(prev_rows) + EMPTY_ROWS - 1
    rng = lambda col: f'{col}{FIRST_ROW}:{col}{end}'
    summary = [
        ('D3', 'Apuestas hechas', 'E3', f'=COUNT({rng("E")})'),
        ('F3', 'Ganadas', 'G3', f'=COUNTIF({rng("G")},"Sí")'),
        ('H3', 'Ganancia real', 'I3', f'=SUM({rng("J")})'),
        ('J3', 'Ganancia esperada', 'K3', f'=SUM({rng("L")})'),
        ('D4', 'De Claude: ganadas', 'E4', f'=COUNTIFS({rng("O")},"Claude",{rng("G")},"Sí")&" de "&COUNTIFS({rng("O")},"Claude",{rng("E")},">0")'),
        ('F4', 'Ganancia (Claude)', 'G4', f'=SUMIF({rng("O")},"Claude",{rng("J")})'),
        ('H4', 'Ideas mías: ganadas', 'I4', f'=COUNTIFS({rng("O")},"Idea mía",{rng("G")},"Sí")&" de "&COUNTIFS({rng("O")},"Idea mía",{rng("E")},">0")'),
        ('J4', 'Ganancia (ideas mías)', 'K4', f'=SUMIF({rng("O")},"Idea mía",{rng("J")})'),
    ]
    for lc, label, vc, formula in summary:
        ws[lc], ws[vc] = label, formula
        ws[lc].font = NEGRITA
        if 'Ganancia' in label:
            ws[vc].number_format = '$#,##0'
    cols = ['Fecha', '¿Cuál apostaste?', 'Detalle (si fue idea tuya)', '¿En qué casa?', '¿Cuánto apostaste?',
            '¿Qué cuota te dieron de verdad?', '¿Ganó? (Sí / No / Devuelta)', '¿Por qué la elegiste? Tu intuición',
            'Probabilidad estimada', 'Ganancia o pérdida', 'Saldo real', 'Ganancia esperada', 'Saldo esperado',
            'Meta ideal (+5 % por apuesta)', '¿De quién fue?']
    header(ws, 6, cols, [11, 46, 24, 12, 12, 12, 12, 34, 11, 12, 12, 12, 12, 14, 12])

    # Lista desplegable con las recomendaciones (de este archivo y del historial)
    listas = wb.create_sheet('Listas')
    listas.sheet_state = 'hidden'
    seen, opts = set(), []
    for p in list(picks) + list(reversed(historial)):
        t = pick_text(p)
        if t not in seen:
            seen.add(t)
            opts.append((t, p['prob'], p.get('resultado')))
    opts.append((OTRA, None, None))
    for i, (t, prob, _) in enumerate(opts, start=1):
        listas.cell(i, 1, t)
        listas.cell(i, 2, prob)
    result_by_text = {t: res for t, _, res in opts}

    for i in range(len(prev_rows) + EMPTY_ROWS):
        r = FIRST_ROW + i
        if i < len(prev_rows):
            row = prev_rows[i]
            gano = row['gano']
            if not gano and result_by_text.get(row['cual']) in ('ganada', 'perdida'):
                gano = 'Sí' if result_by_text[row['cual']] == 'ganada' else 'No'
            for c, v in enumerate([row['fecha'], row['cual'], row['detalle'], row['casa'], row['cuanto'], row['cuota'], gano, row['porque']], start=1):
                ws.cell(r, c, v)
        for c in range(1, 9):
            ws.cell(r, c).fill = EDITABLE
        ws.cell(r, 9, f'=IF(B{r}="","",IFERROR(VLOOKUP(B{r},Listas!$A:$B,2,FALSE),""))')
        ws.cell(r, 10, f'=IF(OR(E{r}="",G{r}=""),"",IF(G{r}="Sí",E{r}*(F{r}-1),IF(G{r}="No",-E{r},0)))')
        ws.cell(r, 11, f'=IF(J{r}="","",$B$3+SUM($J${FIRST_ROW}:J{r}))')
        ws.cell(r, 12, f'=IF(OR(E{r}="",F{r}="",I{r}="",G{r}=""),"",E{r}*(I{r}*F{r}-1))')
        ws.cell(r, 13, f'=IF(K{r}="","",$B$3+SUM($L${FIRST_ROW}:L{r}))')
        ws.cell(r, 14, f'=IF(K{r}="","",ROUND($B$3*1.05^COUNT($J${FIRST_ROW}:J{r}),0))')
        ws.cell(r, 15, f'=IF(B{r}="","",IF(B{r}="{OTRA}","Idea mía","Claude"))')
        # Columnas ocultas para la gráfica (#N/A = sin punto, así no cae a cero en filas vacías)
        ws.cell(r, 17, f'=IF(K{r}="",NA(),K{r})')
        ws.cell(r, 18, f'=IF(M{r}="",NA(),M{r})')
        ws.cell(r, 19, f'=IF(N{r}="",NA(),N{r})')
        for c in (5, 10, 11, 12, 13, 14):
            ws.cell(r, c).number_format = '$#,##0'
        ws.cell(r, 9).number_format = '0%'
    ws['Q6'], ws['R6'], ws['S6'] = 'Saldo real', 'Saldo esperado', 'Meta ideal'
    for col in 'QRS':
        ws.column_dimensions[col].hidden = True

    dv_cual = DataValidation(type='list', formula1=f'=Listas!$A$1:$A${len(opts)}', allow_blank=True)
    dv_casa = DataValidation(type='list', formula1='"BetPlay,Rushbet,Otra"', allow_blank=True)
    dv_gano = DataValidation(type='list', formula1='"Sí,No,Devuelta"', allow_blank=True)
    for dv, col in ((dv_cual, 'B'), (dv_casa, 'D'), (dv_gano, 'G')):
        ws.add_data_validation(dv)
        dv.add(rng(col))

    ch = LineChart()
    ch.title = 'Mi saldo: real vs esperado vs meta'
    ch.y_axis.title, ch.x_axis.title = 'Pesos', 'Número de apuesta'
    ch.add_data(Reference(ws, min_col=17, max_col=19, min_row=6, max_row=end), titles_from_data=True)
    ch.height, ch.width = 9, 20
    ch.visible_cells_only = False  # los datos están en columnas ocultas
    for sr in ch.series:
        sr.smooth = False
    ws.add_chart(ch, 'B' + str(end + 3))
    ws.freeze_panes = f'C{FIRST_ROW}'


def sheet_historial(ws, historial):
    ws['A1'] = 'Historial de recomendaciones (aunque no las hayas apostado)'
    ws['A1'].font = TITULO
    settled = [h for h in historial if h.get('resultado') in ('ganada', 'perdida')]
    won = sum(1 for h in settled if h['resultado'] == 'ganada')
    expected = sum(h['prob'] for h in settled)
    sim = simulate_rule(historial, SALDO_DEFECTO)
    resumen = [
        ('Recomendaciones con resultado', len(settled)),
        ('Ganadas', won),
        ('% de acierto', f"{round(100 * won / len(settled))} %" if settled else '—'),
        ('Ganadas que se esperaban', round(expected, 1)),
        ('Saldo si hubieras seguido todas con la regla del 5 % desde $2.200', round(sim)),
    ]
    for i, (k, v) in enumerate(resumen, start=3):
        ws.cell(i, 1, k).font = NEGRITA
        ws.cell(i, 2, v)
    ws.cell(7, 2).number_format = '$#,##0'
    top = 10
    header(ws, top, ['Fecha', 'Liga', 'Partido', 'Apuesta', 'Cuota ref.', 'Probabilidad', 'Resultado', 'Marcador', 'Archivo',
                     'Aciertos acumulados', 'Aciertos esperados'], [11, 22, 28, 34, 9, 11, 11, 9, 30, 11, 11])
    icon = {'ganada': '✅ Ganó', 'perdida': '❌ Perdió', 'pendiente': '⏳ Pendiente'}
    acc = exp = 0
    rows = sorted(historial, key=lambda h: h['date'])
    for i, h in enumerate(rows, start=1):
        r = top + i
        if h.get('resultado') in ('ganada', 'perdida'):
            acc += h['resultado'] == 'ganada'
            exp += h['prob']
        vals = [local_dt(h['date']).strftime('%d/%m/%Y'), h.get('leagueName', h['league']), f"{h['home']} vs {h['away']}",
                h['label'], round(h['refOdds'], 2), round(h['prob'], 3), icon.get(h.get('resultado'), '⏳ Pendiente'),
                h.get('marcador', ''), h.get('archivo', ''), acc, round(exp, 2)]
        for c, v in enumerate(vals, start=1):
            ws.cell(r, c, v)
        ws.cell(r, 6).number_format = '0%'
    if not rows:
        ws.cell(top + 1, 1, 'Todavía no hay recomendaciones anteriores.')
    ch = LineChart()
    ch.title = 'Recomendaciones: aciertos reales vs esperados'
    ch.y_axis.title, ch.x_axis.title = 'Aciertos acumulados', 'Recomendación'
    ch.add_data(Reference(ws, min_col=10, max_col=11, min_row=top, max_row=top + max(1, len(rows))), titles_from_data=True)
    ch.height, ch.width = 8, 18
    ch.visible_cells_only = False
    for sr in ch.series:
        sr.smooth = False
    ws.add_chart(ch, 'M3')
    ws.freeze_panes = f'A{top + 1}'


def build(data, anterior, salida):
    start, prev_rows = read_previous(anterior)
    saldo = current_balance(start, prev_rows) if prev_rows else start
    wb = Workbook()
    ws = wb.active
    ws.title = 'Apuestas de hoy'
    sheet_apuestas(ws, data, saldo)
    sheet_como_usar(wb.create_sheet('Cómo usar'))
    mis = wb.create_sheet('Mis apuestas')
    hist = wb.create_sheet('Historial')
    sheet_mis_apuestas(mis, wb, start, prev_rows, data['picks'], data.get('historial', []))
    sheet_historial(hist, data.get('historial', []))
    os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    wb.save(salida)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--picks', required=True)
    ap.add_argument('--anterior')
    ap.add_argument('--salida', required=True)
    a = ap.parse_args()
    with open(a.picks, encoding='utf-8') as f:
        data = json.load(f)
    build(data, a.anterior, a.salida)
    print(f'Excel creado: {a.salida} ({len(data["picks"])} apuestas)')


if __name__ == '__main__':
    main()
