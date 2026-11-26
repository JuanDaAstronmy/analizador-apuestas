import { parseDate } from '../core/csv';

/** Un partido jugado, visto desde un equipo. */
export interface TeamGame {
  date: Date;
  home: boolean;
  gf: number;
  ga: number;
  xgf?: number;
  xga?: number;
  cf?: number;
  ca?: number;
  cardsFor?: number;
  cardsAgainst?: number;
  ref?: string;
}

const num = (s: string | undefined) => {
  if (s === undefined || s.trim() === '') return undefined;
  const v = parseFloat(s);
  return isFinite(v) ? v : undefined;
};
const sum = (...xs: (number | undefined)[]) => (xs.every((x) => x === undefined) ? undefined : xs.reduce<number>((s, x) => s + (x ?? 0), 0));

/** Partidos jugados por `team` antes de `before`, del más reciente al más antiguo. */
export function teamGames(rows: Record<string, string>[], team: string, before: Date): TeamGame[] {
  const t = team.trim();
  const out: TeamGame[] = [];
  for (const r of rows) {
    const h = (r.HomeTeam ?? r.Home ?? '').trim();
    const a = (r.AwayTeam ?? r.Away ?? '').trim();
    if (h !== t && a !== t) continue;
    const date = parseDate(r.Date ?? '');
    const hg = num(r.FTHG ?? r.HG);
    const ag = num(r.FTAG ?? r.AG);
    if (!date || hg === undefined || ag === undefined || date.getTime() >= before.getTime()) continue;
    const home = h === t;
    const hc = num(r.HC), ac = num(r.AC);
    const hk = sum(num(r.HY), num(r.HR)), ak = sum(num(r.AY), num(r.AR));
    const hx = num(r.HxG), ax = num(r.AxG);
    out.push({
      date,
      home,
      gf: home ? hg : ag,
      ga: home ? ag : hg,
      xgf: home ? hx : ax,
      xga: home ? ax : hx,
      cf: home ? hc : ac,
      ca: home ? ac : hc,
      cardsFor: home ? hk : ak,
      cardsAgainst: home ? ak : hk,
      ref: r.Referee?.trim() || undefined,
    });
  }
  return out.sort((x, y) => y.date.getTime() - x.date.getTime());
}

/**
 * Promedio con más peso a lo reciente (valores ordenados del más reciente al más antiguo):
 * 50 % los últimos 3, 30 % los partidos 4–8 y 20 % el resto. Si falta algún grupo, se
 * reparte su peso entre los que sí hay. Lista vacía → NaN.
 */
export function weightedMean(values: number[]): number {
  const groups: [number[], number][] = [
    [values.slice(0, 3), 0.5],
    [values.slice(3, 8), 0.3],
    [values.slice(8), 0.2],
  ];
  let s = 0, w = 0;
  for (const [g, gw] of groups) {
    if (!g.length) continue;
    s += (gw * g.reduce((a, b) => a + b, 0)) / g.length;
    w += gw;
  }
  return w ? s / w : NaN;
}

export type StreakKind = 'gana' | 'noPierde' | 'pierde' | 'marca' | 'recibe' | 'sinRecibir' | 'over25' | 'under25' | 'ambos';

const CONDITIONS: Record<StreakKind, (g: TeamGame) => boolean> = {
  gana: (g) => g.gf > g.ga,
  noPierde: (g) => g.gf >= g.ga,
  pierde: (g) => g.gf < g.ga,
  marca: (g) => g.gf > 0,
  recibe: (g) => g.ga > 0,
  sinRecibir: (g) => g.ga === 0,
  over25: (g) => g.gf + g.ga > 2.5,
  under25: (g) => g.gf + g.ga < 2.5,
  ambos: (g) => g.gf > 0 && g.ga > 0,
};

/** Largo de cada racha vigente (cuenta desde el partido más reciente). */
export function streaks(games: TeamGame[]): Record<StreakKind, number> {
  const out = {} as Record<StreakKind, number>;
  for (const k of Object.keys(CONDITIONS) as StreakKind[]) {
    let n = 0;
    while (n < games.length && CONDITIONS[k](games[n])) n++;
    out[k] = n;
  }
  return out;
}

/** Peso de una racha: 0 si dura menos de 5 partidos, sube hasta 1 a los 10 o más. */
export function streakWeight(len: number): number {
  return len < 5 ? 0 : Math.min(1, (len - 4) / 6);
}
