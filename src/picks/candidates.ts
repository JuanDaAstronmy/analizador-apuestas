import { fairProbs } from '../core/betting';
import { rowsToMatches } from '../core/csv';
import { fitModel, expectedGoals } from '../core/model';
import { fitLambdasToMarket, scoreMatrix } from './marketFit';
import { nbOverProb } from './counts';
import { teamGames, weightedMean, streaks, streakWeight, TeamGame, StreakKind } from './teamForm';

export type MarketName = 'Ganador' | 'Doble oportunidad' | 'Goles' | 'Ambos marcan' | 'Goles de un equipo' | 'Hándicap' | 'Córners' | 'Tarjetas';

export interface Candidate {
  matchId: string;
  league: string;
  date: string; // ISO
  home: string;
  away: string;
  /** Código liquidable: "1X2:1", "DC:1X", "OU:2.5:over", "BTTS:yes", "TG:H:1.5:over", "AH:H:-1.5", "CORN:9.5:over", "CARD:3.5:under"… */
  key: string;
  label: string;
  market: MarketName;
  prob: number;
  refOdds: number;
  minOdds: number;
  hasMarketPrice: boolean;
  confidence: 'alta' | 'media';
  reason: string;
}

type Odds = { home?: number; draw?: number; away?: number; over25?: number; under25?: number };

export interface FixtureInput {
  league: string;
  date: Date;
  home: string;
  away: string;
  /** Cuotas para ajustar (preferir Betfair Exchange). */
  odds?: Odds;
  /** Cuotas promedio del mercado para mostrar como referencia (si faltan, se usan `odds`). */
  avgOdds?: Odds;
  referee?: string;
}

export interface LeagueContext {
  rows: Record<string, string>[];
  cornersR: number;
  cardsR: number;
  /** Promedio de tarjetas por partido de cada árbitro (solo árbitros con ≥ 5 partidos). */
  refCards?: Record<string, number>;
}

const BETPLAY_MARGIN = 1.075;
const CLAMP = 0.06;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fin = (x: number, fallback: number) => (Number.isFinite(x) ? x : fallback);

function leagueAverages(rows: Record<string, string>[]) {
  let g = 0, c = 0, k = 0, n = 0, nc = 0, nk = 0;
  for (const r of rows) {
    const hg = parseFloat(r.FTHG ?? r.HG), ag = parseFloat(r.FTAG ?? r.AG);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    g += hg + ag; n++;
    const hc = parseFloat(r.HC), ac = parseFloat(r.AC);
    if (Number.isFinite(hc) && Number.isFinite(ac)) { c += hc + ac; nc++; }
    const cards = ['HY', 'HR', 'AY', 'AR'].map((x) => parseFloat(r[x]));
    if (Number.isFinite(cards[0]) && Number.isFinite(cards[2])) { k += cards.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0); nk++; }
  }
  return { goalsPerTeam: n ? g / (2 * n) : 1.3, corners: nc ? c / nc : NaN, cards: nk ? k / nk : NaN };
}

/** Promedio reciente ponderado de un campo; si el equipo no tiene datos, devuelve `fallback`. */
function form(games: TeamGame[], f: (g: TeamGame) => number | undefined, fallback: number): number {
  const vals = games.map(f).filter((v): v is number => v !== undefined && Number.isFinite(v));
  return fin(weightedMean(vals), fallback);
}

/** Racha de partidos seguidos cuyo total (córners/tarjetas) quedó por encima (+) o por debajo (−) del promedio. */
function countStreak(games: TeamGame[], total: (g: TeamGame) => number | undefined, avg: number): number {
  const first = games[0] ? total(games[0]) : undefined;
  if (first === undefined || !Number.isFinite(avg) || first === avg) return 0;
  const above = first > avg;
  let n = 0;
  for (const g of games) {
    const t = total(g);
    if (t === undefined || (above ? !(t > avg) : !(t < avg))) break;
    n++;
  }
  return above ? n : -n;
}

const goalWord = (n: number) => (n === 1 ? '1 gol' : `${n} goles`);
const veces = (p: number) => `${Math.round(p * 10)} de cada 10`;

export function buildCandidates(fx: FixtureInput, ctx: LeagueContext): Candidate[] {
  const home = fx.home.trim(), away = fx.away.trim();
  const avg = leagueAverages(ctx.rows);
  const gH = teamGames(ctx.rows, home, fx.date);
  const gA = teamGames(ctx.rows, away, fx.date);
  const sH = streaks(gH), sA = streaks(gA);
  const sw = (s: Record<StreakKind, number>, k: StreakKind) => streakWeight(s[k]);

  // 1) Goles esperados base: mercado si hay cuotas 1X2; si no, modelo propio con mucho peso en lo reciente.
  const o = fx.odds;
  let base: { lh: number; la: number } | undefined;
  let withMarket = false;
  /** Probabilidades del mercado (sin margen) para los mercados que traen cuota. */
  const fair: Record<string, number> = {};
  if (o?.home && o.draw && o.away) {
    const [h, d, a] = fairProbs([o.home, o.draw, o.away]);
    const over25 = o.over25 && o.under25 ? fairProbs([o.over25, o.under25])[0] : undefined;
    Object.assign(fair, { '1X2:1': h, '1X2:2': a, 'DC:1X': h + d, 'DC:X2': a + d, 'DC:12': h + a });
    if (over25 !== undefined) Object.assign(fair, { 'OU:2.5:over': over25, 'OU:2.5:under': 1 - over25 });
    base = fitLambdasToMarket({ home: h, draw: d, away: a, over25 });
    withMarket = true;
  } else {
    try {
      const model = fitModel(rowsToMatches(ctx.rows), { asOf: fx.date, halfLifeDays: 120 });
      if (model.teams[home] && model.teams[away]) {
        const e = expectedGoals(model, home, away);
        base = { lh: e.lambdaHome, la: e.lambdaAway };
      }
    } catch {
      /* sin datos suficientes */
    }
  }
  if (!base) return [];

  // 2) Ajuste por forma reciente y rachas (acotado).
  const gpt = avg.goalsPerTeam;
  const atk = (g: TeamGame[]) => form(g, (x) => (x.xgf !== undefined ? (x.gf + x.xgf) / 2 : x.gf), gpt) / gpt;
  const def = (g: TeamGame[]) => form(g, (x) => (x.xga !== undefined ? (x.ga + x.xga) / 2 : x.ga), gpt) / gpt;
  const fH = clamp(1 + 0.15 * (atk(gH) - 1) + 0.15 * (def(gA) - 1) + 0.1 * sw(sH, 'marca') + 0.05 * sw(sA, 'recibe') - 0.1 * sw(sA, 'sinRecibir') + 0.05 * sw(sH, 'gana') - 0.05 * sw(sH, 'pierde'), 0.7, 1.3);
  const fA = clamp(1 + 0.15 * (atk(gA) - 1) + 0.15 * (def(gH) - 1) + 0.1 * sw(sA, 'marca') + 0.05 * sw(sH, 'recibe') - 0.1 * sw(sH, 'sinRecibir') + 0.05 * sw(sA, 'gana') - 0.05 * sw(sA, 'pierde'), 0.7, 1.3);
  const M = scoreMatrix(base.lh * fH, base.la * fA);
  const M0 = withMarket ? scoreMatrix(base.lh, base.la) : undefined;
  const P = (m: number[][], f: (i: number, j: number) => boolean) => m.reduce((s, r, i) => s + r.reduce((t, v, j) => t + (f(i, j) ? v : 0), 0), 0);
  const goalProb = (f: (i: number, j: number) => boolean) => {
    const p = P(M, f);
    return M0 ? clamp(p, P(M0, f) - CLAMP, P(M0, f) + CLAMP) : p;
  };

  const ref = fx.avgOdds ?? fx.odds;
  const marketPrice: Record<string, number | undefined> = withMarket
    ? { '1X2:1': ref?.home, '1X2:2': ref?.away, 'OU:2.5:over': ref?.over25, 'OU:2.5:under': ref?.under25 }
    : {};
  const date = fx.date.toISOString();
  const matchId = `${fx.league}|${home}|${away}|${date.slice(0, 10)}`;
  const out: Candidate[] = [];
  const add = (key: string, label: string, market: MarketName, prob: number, reason: string, conf: 'alta' | 'media') => {
    if (fair[key] !== undefined) prob = clamp(prob, fair[key] - CLAMP, fair[key] + CLAMP);
    prob = clamp(fin(prob, 0), 0.0001, 0.9999);
    const mp = marketPrice[key];
    out.push({
      matchId, league: fx.league, date, home, away, key, label, market, prob,
      refOdds: mp && mp > 1 ? mp : 1 / (prob * BETPLAY_MARGIN),
      minOdds: 1 / prob,
      hasMarketPrice: !!(mp && mp > 1),
      confidence: withMarket && conf === 'alta' ? 'alta' : 'media',
      reason,
    });
  };

  // Frases de respaldo (rachas de 3+ partidos se mencionan; desde 5 además pesan en el cálculo).
  const streakText = (team: string, s: Record<StreakKind, number>, k: StreakKind) => {
    const n = s[k];
    if (n < 3) return '';
    const t: Record<StreakKind, string> = {
      gana: `El ${team} ganó sus últimos ${n} partidos`,
      noPierde: `El ${team} lleva ${n} partidos sin perder`,
      pierde: `El ${team} perdió sus últimos ${n} partidos`,
      marca: `El ${team} marcó en sus últimos ${n} partidos`,
      recibe: `Al ${team} le hicieron gol en sus últimos ${n} partidos`,
      sinRecibir: `El ${team} no recibe gol hace ${n} partidos`,
      over25: `Los últimos ${n} partidos del ${team} tuvieron 3 goles o más`,
      under25: `Los últimos ${n} partidos del ${team} tuvieron 2 goles o menos`,
      ambos: `En los últimos ${n} partidos del ${team} marcaron los dos equipos`,
    };
    return t[k];
  };
  const pick = (...opts: string[]) => opts.find((x) => x) ?? '';
  const fallback = (p: number) => (withMarket ? `Las casas lo ven muy probable: sale unas ${veces(p)} veces` : `Según cómo vienen los equipos, sale unas ${veces(p)} veces`);
  const R = (p: number, ...opts: string[]) => pick(...opts) || fallback(p);

  // Ganador y doble oportunidad
  let p = goalProb((i, j) => i > j);
  add('1X2:1', `Gana el ${home}`, 'Ganador', p, R(p, streakText(home, sH, 'gana'), streakText(away, sA, 'pierde')), 'alta');
  p = goalProb((i, j) => i < j);
  add('1X2:2', `Gana el ${away}`, 'Ganador', p, R(p, streakText(away, sA, 'gana'), streakText(home, sH, 'pierde')), 'alta');
  p = goalProb((i, j) => i >= j);
  add('DC:1X', `El ${home} no pierde (gana o empata)`, 'Doble oportunidad', p, R(p, streakText(home, sH, 'noPierde')), 'alta');
  p = goalProb((i, j) => i <= j);
  add('DC:X2', `El ${away} no pierde (gana o empata)`, 'Doble oportunidad', p, R(p, streakText(away, sA, 'noPierde')), 'alta');
  p = goalProb((i, j) => i !== j);
  add('DC:12', 'Alguno de los dos gana (no hay empate)', 'Doble oportunidad', p, R(p), 'alta');

  // Goles totales
  for (const L of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const n = L + 0.5;
    p = goalProb((i, j) => i + j > L);
    add(`OU:${L}:over`, n === 1 ? 'Habrá al menos 1 gol en el partido' : `Habrá ${n} goles o más en el partido`, 'Goles', p,
      R(p, L === 2.5 ? pick(streakText(home, sH, 'over25'), streakText(away, sA, 'over25')) : ''), 'alta');
    p = goalProb((i, j) => i + j < L);
    add(`OU:${L}:under`, L === 0.5 ? 'Partido sin goles (0-0)' : `Habrá ${goalWord(n - 1)} o menos en el partido`, 'Goles', p,
      R(p, L === 2.5 ? pick(streakText(home, sH, 'under25'), streakText(away, sA, 'under25')) : ''), 'alta');
  }

  // Ambos marcan
  p = goalProb((i, j) => i > 0 && j > 0);
  add('BTTS:yes', 'Los dos equipos marcan', 'Ambos marcan', p, R(p, streakText(home, sH, 'ambos'), streakText(away, sA, 'ambos')), 'alta');
  p = goalProb((i, j) => i === 0 || j === 0);
  add('BTTS:no', 'Al menos un equipo se queda sin marcar', 'Ambos marcan', p, R(p, streakText(home, sH, 'sinRecibir'), streakText(away, sA, 'sinRecibir')), 'alta');

  // Goles de cada equipo
  for (const [side, team, s, cond] of [['H', home, sH, (i: number, _j: number, L: number) => i > L], ['A', away, sA, (_i: number, j: number, L: number) => j > L]] as const) {
    for (const L of [0.5, 1.5]) {
      p = goalProb((i, j) => cond(i, j, L));
      add(`TG:${side}:${L}:over`, L === 0.5 ? `El ${team} marca al menos 1 gol` : `El ${team} marca 2 goles o más`, 'Goles de un equipo', p, R(p, streakText(team, s, 'marca')), 'alta');
    }
  }

  // Hándicap ±1.5
  p = goalProb((i, j) => i - j >= 2);
  add('AH:H:-1.5', `El ${home} gana por 2 goles o más`, 'Hándicap', p, R(p, streakText(home, sH, 'gana')), 'alta');
  p = goalProb((i, j) => i - j <= 1);
  add('AH:A:+1.5', `El ${away} no pierde por 2 goles o más`, 'Hándicap', p, R(p), 'alta');
  p = goalProb((i, j) => j - i >= 2);
  add('AH:A:-1.5', `El ${away} gana por 2 goles o más`, 'Hándicap', p, R(p, streakText(away, sA, 'gana')), 'alta');
  p = goalProb((i, j) => j - i <= 1);
  add('AH:H:+1.5', `El ${home} no pierde por 2 goles o más`, 'Hándicap', p, R(p), 'alta');

  // Córners
  if (Number.isFinite(avg.corners)) {
    const half = avg.corners / 2;
    const tot = (g: TeamGame) => (g.cf !== undefined && g.ca !== undefined ? g.cf + g.ca : undefined);
    const muH = (form(gH, (g) => g.cf, half) + form(gA, (g) => g.ca, half)) / 2;
    const muA = (form(gA, (g) => g.cf, half) + form(gH, (g) => g.ca, half)) / 2;
    const stH = countStreak(gH, tot, avg.corners), stA = countStreak(gA, tot, avg.corners);
    const mu = (muH + muA) * clamp(1 + 0.05 * (Math.sign(stH) * streakWeight(Math.abs(stH)) + Math.sign(stA) * streakWeight(Math.abs(stA))), 0.85, 1.15);
    const recent = (team: string, g: TeamGame[]) => {
      const last = g.slice(0, 3).map(tot).filter((x): x is number => x !== undefined);
      return last.length ? `En los últimos ${last.length} partidos del ${team} hubo en promedio ${(last.reduce((a, b) => a + b, 0) / last.length).toFixed(1)} córners` : '';
    };
    const why = (over: boolean) => pick(
      Math.abs(over ? Math.max(stH, stA) : Math.min(stH, stA)) >= 3 ? `${over ? 'Muchos' : 'Pocos'} córners en los últimos ${Math.abs(over ? Math.max(stH, stA) : Math.min(stH, stA))} partidos de uno de los equipos` : '',
      recent(home, gH), recent(away, gA));
    for (const L of [7.5, 8.5, 9.5, 10.5, 11.5]) {
      p = nbOverProb(mu, ctx.cornersR, L);
      add(`CORN:${L}:over`, `Habrá ${L + 0.5} córners o más`, 'Córners', p, R(p, why(true)), 'media');
      add(`CORN:${L}:under`, `Habrá ${L - 0.5} córners o menos`, 'Córners', 1 - p, R(1 - p, why(false)), 'media');
    }
  }

  // Tarjetas (cada tarjeta cuenta 1)
  if (Number.isFinite(avg.cards)) {
    const half = avg.cards / 2;
    const tot = (g: TeamGame) => (g.cardsFor !== undefined && g.cardsAgainst !== undefined ? g.cardsFor + g.cardsAgainst : undefined);
    const teamsMu = (form(gH, (g) => g.cardsFor, half) + form(gA, (g) => g.cardsAgainst, half)) / 2 + (form(gA, (g) => g.cardsFor, half) + form(gH, (g) => g.cardsAgainst, half)) / 2;
    const refAvg = fx.referee ? ctx.refCards?.[fx.referee.trim()] : undefined;
    const stH = countStreak(gH, tot, avg.cards), stA = countStreak(gA, tot, avg.cards);
    const mu = (refAvg !== undefined ? 0.5 * teamsMu + 0.5 * refAvg : teamsMu) * clamp(1 + 0.05 * (Math.sign(stH) * streakWeight(Math.abs(stH)) + Math.sign(stA) * streakWeight(Math.abs(stA))), 0.85, 1.15);
    const refText = refAvg !== undefined && fx.referee ? `El árbitro ${fx.referee.trim()} saca en promedio ${refAvg.toFixed(1)} tarjetas por partido` : '';
    const recent = (team: string, g: TeamGame[]) => {
      const last = g.slice(0, 3).map(tot).filter((x): x is number => x !== undefined);
      return last.length ? `En los últimos ${last.length} partidos del ${team} hubo en promedio ${(last.reduce((a, b) => a + b, 0) / last.length).toFixed(1)} tarjetas` : '';
    };
    for (const L of [2.5, 3.5, 4.5, 5.5]) {
      p = nbOverProb(mu, ctx.cardsR, L);
      add(`CARD:${L}:over`, `Habrá ${L + 0.5} tarjetas o más`, 'Tarjetas', p, R(p, refText, recent(home, gH), recent(away, gA)), 'media');
      add(`CARD:${L}:under`, `Habrá ${L - 0.5} tarjetas o menos`, 'Tarjetas', 1 - p, R(1 - p, refText, recent(home, gH), recent(away, gA)), 'media');
    }
  }
  return out;
}
