/**
 * Simulación Monte Carlo de la evolución del bankroll.
 *
 * Responde preguntas como: "si hago 200 apuestas con estas características,
 * ¿qué tan probable es terminar perdiendo?, ¿qué tan profunda puede ser la peor racha?"
 */

/** Generador pseudoaleatorio con semilla (mulberry32), para resultados reproducibles. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimParams {
  startBankroll: number;
  nBets: number;
  /** Probabilidad REAL de ganar cada apuesta (no la que crees). */
  pWin: number;
  odds: number;
  /** Fracción del bankroll por apuesta (stake proporcional). */
  stakePct: number;
  nSims: number;
  seed?: number;
}

export interface SimResult {
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  probLoss: number;
  probDrawdown30: number;
  medianMaxDrawdown: number;
  meanFinal: number;
  /** Algunas trayectorias para graficar. */
  samplePaths: number[][];
  /** Mediana del bankroll en cada paso. */
  medianPath: number[];
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

export function simulateBankroll(p: SimParams): SimResult {
  const r = rng(p.seed ?? 12345);
  const finals: number[] = [];
  const dds: number[] = [];
  const samplePaths: number[][] = [];
  const step = Math.max(1, Math.floor(p.nBets / 60));
  const columns: number[][] = Array.from({ length: Math.floor(p.nBets / step) + 1 }, () => []);
  let dd30 = 0;

  for (let s = 0; s < p.nSims; s++) {
    let bank = p.startBankroll;
    let peak = bank;
    let maxDD = 0;
    const path = [bank];
    columns[0].push(bank);
    for (let k = 1; k <= p.nBets; k++) {
      const stake = bank * p.stakePct;
      bank += r() < p.pWin ? stake * (p.odds - 1) : -stake;
      if (bank > peak) peak = bank;
      const dd = (peak - bank) / peak;
      if (dd > maxDD) maxDD = dd;
      if (k % step === 0) {
        columns[k / step].push(bank);
        if (s < 25) path.push(bank);
      }
    }
    finals.push(bank);
    dds.push(maxDD);
    if (maxDD >= 0.3) dd30++;
    if (s < 25) samplePaths.push(path);
  }
  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  return {
    percentiles: {
      p5: quantile(finals, 0.05),
      p25: quantile(finals, 0.25),
      p50: quantile(finals, 0.5),
      p75: quantile(finals, 0.75),
      p95: quantile(finals, 0.95),
    },
    probLoss: finals.filter((f) => f < p.startBankroll).length / p.nSims,
    probDrawdown30: dd30 / p.nSims,
    medianMaxDrawdown: quantile(dds, 0.5),
    meanFinal: finals.reduce((a, b) => a + b, 0) / p.nSims,
    samplePaths,
    medianPath: columns.filter((c) => c.length).map((c) => quantile([...c].sort((a, b) => a - b), 0.5)),
  };
}
