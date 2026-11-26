import { parseDate } from '../core/csv';
import type { Candidate } from './candidates';

export type Resultado = 'pendiente' | 'ganada' | 'perdida';
export type HistEntry = Candidate & { archivo: string; resultado: Resultado; marcador?: string; leagueName?: string };

const n = (s?: string) => {
  const v = parseFloat(s ?? '');
  return Number.isFinite(v) ? v : undefined;
};

/** Decide si la apuesta ganó con el marcador final; undefined si faltan datos (córners/tarjetas). */
function evaluate(key: string, r: Record<string, string>, hg: number, ag: number): boolean | undefined {
  const [kind, a, b, c] = key.split(':');
  switch (kind) {
    case '1X2': return a === '1' ? hg > ag : a === '2' ? hg < ag : hg === ag;
    case 'DC': return a === '1X' ? hg >= ag : a === 'X2' ? hg <= ag : hg !== ag;
    case 'OU': return b === 'over' ? hg + ag > +a : hg + ag < +a;
    case 'BTTS': return a === 'yes' ? hg > 0 && ag > 0 : hg === 0 || ag === 0;
    case 'TG': { const g = a === 'H' ? hg : ag; return c === 'over' ? g > +b : g < +b; }
    case 'AH': { const diff = a === 'H' ? hg - ag : ag - hg; return diff + +b > 0; }
    case 'CORN': {
      const hc = n(r.HC), ac = n(r.AC);
      if (hc === undefined || ac === undefined) return undefined;
      return b === 'over' ? hc + ac > +a : hc + ac < +a;
    }
    case 'CARD': {
      const parts = ['HY', 'HR', 'AY', 'AR'].map((x) => n(r[x]));
      if (parts[0] === undefined || parts[2] === undefined) return undefined;
      const t = parts.reduce<number>((s, v) => s + (v ?? 0), 0);
      return b === 'over' ? t > +a : t < +a;
    }
  }
  return undefined;
}

/** Busca el resultado del partido (misma liga, mismos equipos, fecha a ±1 día) y liquida la apuesta. */
export function settle(e: HistEntry, rows: Record<string, string>[], _now: Date): HistEntry {
  if (e.resultado !== 'pendiente') return e;
  const t = new Date(e.date).getTime();
  const r = rows.find((x) => {
    if (x.__league !== undefined && x.__league !== e.league) return false;
    if ((x.HomeTeam ?? x.Home ?? '').trim() !== e.home || (x.AwayTeam ?? x.Away ?? '').trim() !== e.away) return false;
    const d = parseDate(x.Date ?? '');
    return !!d && Math.abs(d.getTime() - t) <= 1.5 * 86400000;
  });
  if (!r) return e;
  const hg = n(r.FTHG ?? r.HG), ag = n(r.FTAG ?? r.AG);
  if (hg === undefined || ag === undefined) return e;
  const won = evaluate(e.key, r, hg, ag);
  if (won === undefined) return e;
  return { ...e, resultado: won ? 'ganada' : 'perdida', marcador: `${hg}-${ag}` };
}

export function settleAll(list: HistEntry[], rows: Record<string, string>[], now: Date): HistEntry[] {
  return list.map((e) => settle(e, rows, now));
}

/** Agrega las nuevas recomendaciones al historial sin duplicar (mismo partido y misma apuesta). */
export function mergeHistory(hist: HistEntry[], picks: (Candidate & { leagueName?: string })[], archivo: string): HistEntry[] {
  const seen = new Set(hist.map((h) => `${h.matchId}#${h.key}`));
  const add = picks.filter((p) => !seen.has(`${p.matchId}#${p.key}`)).map((p) => ({ ...p, archivo, resultado: 'pendiente' as const }));
  return [...hist, ...add];
}
