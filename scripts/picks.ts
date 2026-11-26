/// <reference types="node" />
/**
 * Genera las apuestas recomendadas de una ventana y actualiza el historial.
 *   npx tsx scripts/picks.ts --ventana lunes|jueves|martes|viernes --fecha YYYY-MM-DD \
 *     --datos DIR --historial picks/historial.json --salida salida/picks.json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseCsv, parseDate } from '../src/core/csv';
import { buildCandidates, Candidate, FixtureInput, LeagueContext } from '../src/picks/candidates';
import { dispersion } from '../src/picks/counts';
import { choosePicks, windowFor, WindowKind } from '../src/picks/select';
import { MAIN_LEAGUES, NEW_LEAGUES, leagueName } from '../src/picks/leagues';
import { HistEntry, mergeHistory, settleAll } from '../src/picks/settle';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`Falta --${name}`);
};
const ventana = arg('ventana') as WindowKind;
const fecha = new Date(`${arg('fecha')}T12:00:00Z`);
const dir = arg('datos');
const histPath = arg('historial', 'picks/historial.json');
const outPath = arg('salida', 'salida/picks.json');

const read = (f: string) => (existsSync(join(dir, f)) ? parseCsv(readFileSync(join(dir, f), 'utf8')) : []);
const files = readdirSync(dir);

/** Historia por liga (temporadas recientes primero no importa: las funciones ordenan por fecha). */
function historyRows(code: string): Record<string, string>[] {
  if (NEW_LEAGUES[code]) {
    const cutoff = fecha.getTime() - 3 * 365 * 86400000;
    return read(`new_${code}.csv`).filter((r) => (parseDate(r.Date ?? '')?.getTime() ?? 0) >= cutoff);
  }
  return files.filter((f) => f.startsWith('mmz4281_') && f.endsWith(`_${code}.csv`)).flatMap((f) => read(f));
}

/** Hora del Reino Unido → UTC (horario de verano británico entre el último domingo de marzo y el de octubre). */
function ukToUtc(date: Date, time: string): Date {
  const [hh, mm] = (time || '15:00').split(':').map((x) => parseInt(x, 10));
  const y = date.getUTCFullYear();
  const lastSunday = (month: number) => {
    const d = new Date(Date.UTC(y, month + 1, 0));
    return d.getUTCDate() - d.getUTCDay();
  };
  const t = Date.UTC(y, date.getUTCMonth(), date.getUTCDate(), hh || 0, mm || 0);
  const bstStart = Date.UTC(y, 2, lastSunday(2), 1), bstEnd = Date.UTC(y, 9, lastSunday(9), 1);
  return new Date(t >= bstStart && t < bstEnd ? t - 3600000 : t);
}

const num = (s?: string) => {
  const v = parseFloat(s ?? '');
  return Number.isFinite(v) && v > 1 ? v : undefined;
};
function odds(r: Record<string, string>, prefix: string) {
  const o = {
    home: num(r[`${prefix}H`]), draw: num(r[`${prefix}D`]), away: num(r[`${prefix}A`]),
    over25: num(r[`${prefix}>2.5`]), under25: num(r[`${prefix}<2.5`]),
  };
  return o.home && o.draw && o.away ? o : undefined;
}

// Próximos partidos de la ventana
const win = windowFor(ventana, fecha);
const fixtures: FixtureInput[] = [];
for (const r of read('fixtures.csv')) {
  if (!MAIN_LEAGUES[r.Div]) continue;
  const d = parseDate(r.Date ?? '');
  if (!d) continue;
  fixtures.push({ league: r.Div, date: ukToUtc(d, r.Time), home: r.HomeTeam.trim(), away: r.AwayTeam.trim(), odds: odds(r, 'BFE') ?? odds(r, 'Avg'), avgOdds: odds(r, 'Avg'), referee: r.Referee });
}
const byCountry = Object.fromEntries(Object.entries(NEW_LEAGUES).map(([code, [country]]) => [country, code]));
for (const r of read('new_league_fixtures.csv')) {
  const code = byCountry[(r.Country ?? '').trim()];
  const d = parseDate(r.Date ?? '');
  if (!code || !d) continue;
  fixtures.push({ league: code, date: ukToUtc(d, r.Time), home: r.Home.trim(), away: r.Away.trim(), odds: odds(r, 'BFE') ?? odds(r, 'PS') ?? odds(r, 'Avg'), avgOdds: odds(r, 'Avg') });
}
const inWindow = fixtures.filter((f) => f.date >= win.from && f.date <= win.to);

// Candidatas
const ctxCache = new Map<string, LeagueContext>();
function ctxFor(code: string): LeagueContext {
  if (ctxCache.has(code)) return ctxCache.get(code)!;
  const rows = historyRows(code);
  const tot = (a: string[]) => rows.map((r) => a.reduce((s, c) => s + parseFloat(r[c]), 0)).filter(Number.isFinite);
  const refs = new Map<string, number[]>();
  for (const r of rows) {
    const k = ['HY', 'HR', 'AY', 'AR'].reduce((s, c) => s + (parseFloat(r[c]) || 0), 0);
    if (r.Referee?.trim() && r.HY !== undefined && r.HY !== '') refs.set(r.Referee.trim(), [...(refs.get(r.Referee.trim()) ?? []), k]);
  }
  const refCards = Object.fromEntries([...refs].filter(([, v]) => v.length >= 5).map(([n, v]) => [n, v.reduce((a, b) => a + b, 0) / v.length]));
  const ctx = { rows, cornersR: dispersion(tot(['HC', 'AC'])), cardsR: dispersion(tot(['HY', 'HR', 'AY', 'AR'])), refCards };
  ctxCache.set(code, ctx);
  return ctx;
}
const cands: Candidate[] = inWindow.flatMap((f) => {
  const ctx = ctxFor(f.league);
  return ctx.rows.length ? buildCandidates(f, ctx) : [];
});
const picks = choosePicks(cands).map((c) => ({ ...c, leagueName: leagueName(c.league) }));

// Historial: liquidar pendientes con los resultados disponibles y agregar las nuevas
const archivo = `Apuestas_${arg('fecha')}_${ventana}.xlsx`;
const prev: HistEntry[] = existsSync(histPath) ? JSON.parse(readFileSync(histPath, 'utf8')) : [];
const allRows = [...Object.keys(MAIN_LEAGUES), ...Object.keys(NEW_LEAGUES)].flatMap((c) => historyRows(c).map((r) => ({ ...r, __league: c })));
const historial = mergeHistory(settleAll(prev, allRows, new Date()), picks, archivo);
mkdirSync(dirname(histPath), { recursive: true });
writeFileSync(histPath, JSON.stringify(historial, null, 1));

let nota: string | undefined;
if (!inWindow.length) nota = 'Todavía no hay cuotas publicadas de los partidos de esta ventana. Revisa el próximo archivo.';
else if (!picks.length) nota = `Hay ${inWindow.length} partidos, pero ninguna apuesta cumple las reglas (cuota 1.20–1.60 y 7 de cada 10 o más). Mejor no apostar esta vez.`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ generado: new Date().toISOString(), ventana, desde: win.from, hasta: win.to, archivo, partidos: inWindow.length, nota, picks, historial }, null, 1));
console.log(`Ventana ${ventana}: ${inWindow.length} partidos, ${cands.length} candidatas, ${picks.length} recomendadas.${nota ? ' Nota: ' + nota : ''}`);
for (const p of picks) console.log(`  ${(p.prob * 100).toFixed(0)}% @${p.refOdds.toFixed(2)}  ${p.home} vs ${p.away} — ${p.label} — ${p.reason}`);
