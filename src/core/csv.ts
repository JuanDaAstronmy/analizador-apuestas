import { Match, MatchOdds } from './types';

/** Parser CSV mínimo (soporta comillas dobles). Devuelve filas como objetos por encabezado. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, j) => {
      if (h) o[h] = (r[j] ?? '').trim();
    });
    return o;
  });
}

/** Fechas tipo dd/mm/yy o dd/mm/yyyy (formato de football-data.co.uk). */
export function parseDate(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  const d = new Date(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10), 12));
  return isNaN(d.getTime()) ? null : d;
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const v = parseFloat(s);
  return isFinite(v) ? v : undefined;
}

/** Toma la primera columna disponible con una cuota válida (> 1). */
function firstOdd(r: Record<string, string>, cols: string[]): number | undefined {
  for (const c of cols) {
    const v = num(r[c]);
    if (v !== undefined && v > 1) return v;
  }
  return undefined;
}

/**
 * Preferimos cuotas de cierre de Pinnacle (las más "eficientes" del mercado),
 * luego el promedio del mercado y por último Bet365.
 */
function extractOdds(r: Record<string, string>): MatchOdds | undefined {
  const odds: MatchOdds = {
    home: firstOdd(r, ['PSCH', 'AvgCH', 'PSH', 'AvgH', 'B365CH', 'B365H']),
    draw: firstOdd(r, ['PSCD', 'AvgCD', 'PSD', 'AvgD', 'B365CD', 'B365D']),
    away: firstOdd(r, ['PSCA', 'AvgCA', 'PSA', 'AvgA', 'B365CA', 'B365A']),
    over25: firstOdd(r, ['PC>2.5', 'AvgC>2.5', 'P>2.5', 'Avg>2.5', 'B365C>2.5', 'B365>2.5']),
    under25: firstOdd(r, ['PC<2.5', 'AvgC<2.5', 'P<2.5', 'Avg<2.5', 'B365C<2.5', 'B365<2.5']),
  };
  return Object.values(odds).some((v) => v !== undefined) ? odds : undefined;
}

/**
 * Convierte filas de football-data.co.uk a partidos. Soporta los dos formatos:
 *  - Ligas principales: Div, Date, HomeTeam, AwayTeam, FTHG, FTAG
 *  - "Nuevas ligas" (Colombia, Argentina, ...): Country, League, Date, Home, Away, HG, AG
 */
export function rowsToMatches(rows: Record<string, string>[], leagueFallback = ''): Match[] {
  const out: Match[] = [];
  for (const r of rows) {
    const home = r.HomeTeam ?? r.Home;
    const away = r.AwayTeam ?? r.Away;
    const date = parseDate(r.Date ?? '');
    if (!home || !away || !date) continue;
    out.push({
      date,
      league: r.Div || r.League || leagueFallback,
      home,
      away,
      hg: num(r.FTHG ?? r.HG),
      ag: num(r.FTAG ?? r.AG),
      odds: extractOdds(r),
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function parseMatchesCsv(text: string, leagueFallback = ''): Match[] {
  return rowsToMatches(parseCsv(text), leagueFallback);
}
