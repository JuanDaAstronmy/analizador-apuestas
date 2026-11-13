import { Match } from '../core/types';
import { parseCsv, rowsToMatches } from '../core/csv';

/**
 * Fuente de datos: football-data.co.uk (gratis, sin API key). Trae resultados
 * históricos Y cuotas de cierre de las casas, que es lo que permite medir si el
 * modelo realmente le gana al mercado.
 *
 * Formato "main": un CSV por temporada (ej. 2526 = 2025/26).
 * Formato "new": un CSV con todas las temporadas (ligas de América y otras).
 */
export interface League {
  code: string;
  name: string;
  country: string;
  kind: 'main' | 'new';
}

export const LEAGUES: League[] = [
  { code: 'E0', name: 'Premier League', country: 'Inglaterra', kind: 'main' },
  { code: 'SP1', name: 'LaLiga', country: 'España', kind: 'main' },
  { code: 'I1', name: 'Serie A', country: 'Italia', kind: 'main' },
  { code: 'D1', name: 'Bundesliga', country: 'Alemania', kind: 'main' },
  { code: 'F1', name: 'Ligue 1', country: 'Francia', kind: 'main' },
  { code: 'N1', name: 'Eredivisie', country: 'Países Bajos', kind: 'main' },
  { code: 'P1', name: 'Primeira Liga', country: 'Portugal', kind: 'main' },
  { code: 'E1', name: 'Championship', country: 'Inglaterra', kind: 'main' },
  { code: 'T1', name: 'Süper Lig', country: 'Turquía', kind: 'main' },
  { code: 'ARG', name: 'Liga Profesional', country: 'Argentina', kind: 'new' },
  { code: 'BRA', name: 'Brasileirão Serie A', country: 'Brazil', kind: 'new' },
  { code: 'MEX', name: 'Liga MX', country: 'Mexico', kind: 'new' },
  { code: 'USA', name: 'MLS', country: 'USA', kind: 'new' },
];

const BASE = 'https://football-data.co.uk';

/** Código de temporada europea para una fecha: nov-2026 → "2627". */
export function seasonCode(d: Date, offset = 0): string {
  const startYear = (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1) + offset;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return yy(startYear) + yy(startYear + 1);
}

export function historyUrls(league: League, now = new Date(), seasons = 3): string[] {
  if (league.kind === 'new') return [`${BASE}/new/${league.code}.csv`];
  return Array.from({ length: seasons }, (_, i) => `${BASE}/mmz4281/${seasonCode(now, -i)}/${league.code}.csv`);
}

export function fixturesUrl(league: League): string {
  return league.kind === 'new' ? `${BASE}/new_league_fixtures.csv` : `${BASE}/fixtures.csv`;
}

async function getText(url: string, timeoutMs = 45000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    return await res.text();
  } catch (e) {
    const msg = ctrl.signal.aborted ? `tiempo de espera agotado (${timeoutMs / 1000} s)` : e instanceof Error ? e.message : String(e);
    throw new Error(`${url.replace('https://', '')}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Filtra filas de un CSV de próximos partidos que pertenecen a la liga. */
export function filterFixtureRows(rows: Record<string, string>[], league: League) {
  return league.kind === 'new' ? rows.filter((r) => r.Country === league.country) : rows.filter((r) => r.Div === league.code);
}

export interface LeagueData {
  league: League;
  history: Match[];
  fixtures: Match[];
  loadedAt: string;
}

export async function loadLeague(league: League, now = new Date()): Promise<LeagueData> {
  const errors: string[] = [];
  const texts = await Promise.all(
    historyUrls(league, now).map((u) =>
      getText(u).catch((e) => {
        // La temporada actual puede no existir aún al inicio; no es fatal.
        errors.push(e instanceof Error ? e.message : String(e));
        return '';
      }),
    ),
  );
  const history = texts
    .flatMap((t) => (t ? rowsToMatches(parseCsv(t), league.code) : []))
    .filter((m) => m.hg !== undefined)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (history.length === 0)
    throw new Error(
      'No se pudieron descargar datos históricos de esta liga.' + (errors.length ? `\nDetalle: ${errors.join(' | ')}` : ''),
    );

  let fixtures: Match[] = [];
  try {
    const rows = filterFixtureRows(parseCsv(await getText(fixturesUrl(league))), league);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    fixtures = rowsToMatches(rows, league.code).filter((m) => m.hg === undefined && m.date.getTime() >= today - 86400000);
  } catch (e) {
    console.warn(String(e));
  }
  return { league, history, fixtures, loadedAt: new Date().toISOString() };
}
