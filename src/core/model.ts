import { PlayedMatch, isPlayed, Match } from './types';

/**
 * Modelo de Poisson bivariado tipo Dixon-Coles (1997).
 *
 *   goles_local     ~ Poisson(λ),  λ = γ · α_local · β_visitante
 *   goles_visitante ~ Poisson(μ),  μ =     α_visitante · β_local
 *
 * α = fuerza de ataque, β = debilidad defensiva (más alto = recibe más goles),
 * γ = ventaja de local. Se añade la corrección τ(ρ) de Dixon-Coles para los
 * marcadores bajos (0-0, 1-0, 0-1, 1-1), que el Poisson independiente subestima/sobreestima.
 *
 * Ajuste: máxima verosimilitud ponderada en el tiempo (los partidos viejos pesan
 * menos, w = exp(-ln2 · días / vidaMedia)) resuelta por iteración de punto fijo
 * (cada parámetro tiene solución cerrada dado el resto). Se agrega una
 * regularización tipo "pseudo-partidos" que encoge los equipos con pocos datos
 * hacia el promedio de la liga.
 */
export interface ModelOptions {
  /** Vida media de los pesos temporales, en días. */
  halfLifeDays: number;
  /** Fuerza de la regularización, en "partidos ficticios" de un equipo promedio. */
  shrinkage: number;
  maxIter: number;
  tol: number;
  /** Fecha de referencia (los partidos posteriores se ignoran). Por defecto: el último partido. */
  asOf?: Date;
  /** Ventana máxima de historia, en días. */
  maxHistoryDays: number;
  /**
   * Prior para equipos nuevos en la liga (ascendidos): en vez de encogerlos hacia
   * el promedio, se encogen hacia el nivel del cuartil más débil de la liga.
   */
  newTeamPrior: boolean;
}

export const DEFAULT_MODEL_OPTIONS: ModelOptions = {
  halfLifeDays: 365,
  shrinkage: 3,
  maxIter: 200,
  tol: 1e-7,
  maxHistoryDays: 3 * 365,
  newTeamPrior: true,
};

export interface TeamRating {
  attack: number;
  defense: number;
  /** Número efectivo de partidos (suma de pesos) usado para estimar al equipo. */
  effMatches: number;
  matches: number;
}

export interface FittedModel {
  teams: Record<string, TeamRating>;
  homeAdv: number;
  rho: number;
  asOf: Date;
  nMatches: number;
  avgGoals: number;
}

const DAY = 86400000;
const MAX_GOALS = 10;

export function fitModel(all: Match[], opts: Partial<ModelOptions> = {}): FittedModel {
  const o = { ...DEFAULT_MODEL_OPTIONS, ...opts };
  const played = all.filter(isPlayed);
  const asOf = o.asOf ?? (played.length ? played[played.length - 1].date : new Date());
  const t0 = asOf.getTime();
  const lambdaDecay = Math.LN2 / o.halfLifeDays;

  const data: { m: PlayedMatch; w: number }[] = [];
  for (const m of played) {
    const ageDays = (t0 - m.date.getTime()) / DAY;
    if (ageDays < 0 || ageDays > o.maxHistoryDays) continue;
    data.push({ m, w: Math.exp(-lambdaDecay * ageDays) });
  }
  if (data.length === 0) throw new Error('No hay partidos jugados para ajustar el modelo.');

  const names = Array.from(new Set(data.flatMap(({ m }) => [m.home, m.away]))).sort();
  const idx = new Map(names.map((n, i) => [n, i]));
  const n = names.length;
  const H = new Int32Array(data.length);
  const A = new Int32Array(data.length);
  data.forEach(({ m }, k) => {
    H[k] = idx.get(m.home)!;
    A[k] = idx.get(m.away)!;
  });

  // Estadísticos suficientes por equipo (no cambian durante la iteración).
  const scored = new Float64Array(n);
  const conceded = new Float64Array(n);
  const effMatches = new Float64Array(n);
  const count = new Int32Array(n);
  let sumW = 0;
  let sumHG = 0;
  let sumAG = 0;
  data.forEach(({ m, w }, k) => {
    scored[H[k]] += w * m.hg;
    scored[A[k]] += w * m.ag;
    conceded[H[k]] += w * m.ag;
    conceded[A[k]] += w * m.hg;
    effMatches[H[k]] += w;
    effMatches[A[k]] += w;
    count[H[k]]++;
    count[A[k]]++;
    sumW += w;
    sumHG += w * m.hg;
    sumAG += w * m.ag;
  });
  const avgPerTeam = (sumHG + sumAG) / (2 * sumW);

  // Equipos "nuevos": su primer partido en la ventana llega bastante después del inicio
  // de los datos (típicamente, recién ascendidos).
  const firstSeen = new Float64Array(n).fill(Infinity);
  data.forEach(({ m }, j) => {
    const t = m.date.getTime();
    if (t < firstSeen[H[j]]) firstSeen[H[j]] = t;
    if (t < firstSeen[A[j]]) firstSeen[A[j]] = t;
  });
  const dataStart = Math.min(...Array.from(firstSeen));
  const isNew = Array.from(firstSeen, (t) => o.newTeamPrior && t - dataStart > 150 * DAY);
  const quantile = (xs: number[], q: number) => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : NaN;
  };

  const att = new Float64Array(n).fill(1);
  const def = new Float64Array(n).fill(avgPerTeam);
  let gamma = sumAG > 0 ? sumHG / sumAG : 1.2;
  const k = o.shrinkage;

  for (let iter = 0; iter < o.maxIter; iter++) {
    let delta = 0;
    // Objetivos del prior: promedio para equipos establecidos; cuartil débil para los nuevos.
    const est = Array.from({ length: n }, (_, i) => i).filter((i) => !isNew[i]);
    const attNewTarget = est.length >= 4 ? quantile(est.map((i) => att[i]), 0.2) : 1;
    const defNewTarget = est.length >= 4 ? quantile(est.map((i) => def[i]), 0.8) : NaN;

    // Actualizar ataques.
    const denA = new Float64Array(n);
    data.forEach(({ w }, j) => {
      denA[H[j]] += w * gamma * def[A[j]];
      denA[A[j]] += w * def[H[j]];
    });
    for (let i = 0; i < n; i++) {
      // Pseudo-observaciones: k "goles esperados" con ataque = 1 (promedio).
      const meanDen = denA[i] / Math.max(effMatches[i], 1e-9);
      const target = isNew[i] ? attNewTarget : 1;
      const v = (scored[i] + k * meanDen * target) / (denA[i] + k * meanDen);
      delta = Math.max(delta, Math.abs(v - att[i]));
      att[i] = v;
    }
    // Identificabilidad: media geométrica de ataques = 1.
    let logMean = 0;
    for (let i = 0; i < n; i++) logMean += Math.log(att[i]);
    const g = Math.exp(logMean / n);
    for (let i = 0; i < n; i++) att[i] /= g;

    // Actualizar defensas.
    const denD = new Float64Array(n);
    data.forEach(({ w }, j) => {
      denD[A[j]] += w * gamma * att[H[j]];
      denD[H[j]] += w * att[A[j]];
    });
    let defMean = 0;
    for (let i = 0; i < n; i++) defMean += def[i];
    defMean /= n;
    for (let i = 0; i < n; i++) {
      const meanDen = denD[i] / Math.max(effMatches[i], 1e-9);
      const target = isNew[i] && isFinite(defNewTarget) ? defNewTarget : defMean;
      const v = (conceded[i] + k * meanDen * target) / (denD[i] + k * meanDen);
      delta = Math.max(delta, Math.abs(v - def[i]));
      def[i] = v;
    }

    // Ventaja de local.
    let den = 0;
    data.forEach(({ w }, j) => {
      den += w * att[H[j]] * def[A[j]];
    });
    const newGamma = sumHG / den;
    delta = Math.max(delta, Math.abs(newGamma - gamma));
    gamma = newGamma;

    if (delta < o.tol) break;
  }

  // ρ de Dixon-Coles por búsqueda en malla sobre la log-verosimilitud ponderada.
  let bestRho = 0;
  let bestLL = -Infinity;
  for (let rho = -0.25; rho <= 0.1001; rho += 0.005) {
    let ll = 0;
    for (let j = 0; j < data.length; j++) {
      const { m, w } = data[j];
      const lam = gamma * att[H[j]] * def[A[j]];
      const mu = att[A[j]] * def[H[j]];
      const t = tau(m.hg, m.ag, lam, mu, rho);
      if (t <= 0) {
        ll = -Infinity;
        break;
      }
      ll += w * Math.log(t);
    }
    if (ll > bestLL) {
      bestLL = ll;
      bestRho = rho;
    }
  }

  const teams: Record<string, TeamRating> = {};
  names.forEach((name, i) => {
    teams[name] = { attack: att[i], defense: def[i], effMatches: effMatches[i], matches: count[i] };
  });
  return {
    teams,
    homeAdv: gamma,
    rho: Math.round(bestRho * 1000) / 1000,
    asOf,
    nMatches: data.length,
    avgGoals: (sumHG + sumAG) / sumW,
  };
}

/** Factor de corrección de Dixon-Coles para marcadores bajos. */
export function tau(x: number, y: number, lam: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lam * mu * rho;
  if (x === 0 && y === 1) return 1 + lam * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function poissonPmf(lam: number, maxK: number): number[] {
  const p = new Array<number>(maxK + 1);
  p[0] = Math.exp(-lam);
  for (let i = 1; i <= maxK; i++) p[i] = (p[i - 1] * lam) / i;
  return p;
}

export interface Prediction {
  home: string;
  away: string;
  lambdaHome: number;
  lambdaAway: number;
  /** matrix[i][j] = P(local marca i, visitante marca j) */
  matrix: number[][];
  /** Confianza en los datos: 'alta' | 'media' | 'baja' según partidos disponibles. */
  dataQuality: 'alta' | 'media' | 'baja';
  minTeamMatches: number;
}

export function expectedGoals(model: FittedModel, home: string, away: string) {
  const h = model.teams[home];
  const a = model.teams[away];
  if (!h || !a) throw new Error(`Equipo sin datos: ${!h ? home : away}`);
  return {
    lambdaHome: model.homeAdv * h.attack * a.defense,
    lambdaAway: a.attack * h.defense,
  };
}

export function predict(model: FittedModel, home: string, away: string): Prediction {
  const { lambdaHome, lambdaAway } = expectedGoals(model, home, away);
  const ph = poissonPmf(lambdaHome, MAX_GOALS);
  const pa = poissonPmf(lambdaAway, MAX_GOALS);
  const matrix: number[][] = [];
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    matrix.push([]);
    for (let j = 0; j <= MAX_GOALS; j++) {
      const v = ph[i] * pa[j] * tau(i, j, lambdaHome, lambdaAway, model.rho);
      matrix[i].push(v);
      total += v;
    }
  }
  // Renormalizar (la cola > MAX_GOALS es despreciable pero así suma exactamente 1).
  for (const r of matrix) for (let j = 0; j < r.length; j++) r[j] /= total;

  const minTeamMatches = Math.min(model.teams[home].matches, model.teams[away].matches);
  const dataQuality = minTeamMatches >= 30 ? 'alta' : minTeamMatches >= 12 ? 'media' : 'baja';
  return { home, away, lambdaHome, lambdaAway, matrix, dataQuality, minTeamMatches };
}

/** Ranking de equipos por diferencia ataque/defensa (útil para mostrar en la app). */
export function teamTable(model: FittedModel) {
  const ts = Object.values(model.teams);
  const meanDef = ts.reduce((s, t) => s + t.defense, 0) / Math.max(ts.length, 1);
  return Object.entries(model.teams)
    .map(([name, t]) => ({
      name,
      attack: t.attack,
      defense: t.defense,
      // Diferencia de goles esperada contra un rival promedio en campo neutral.
      strength: t.attack * meanDef - t.defense,
      matches: t.matches,
    }))
    .sort((a, b) => b.strength - a.strength);
}
