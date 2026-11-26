/**
 * Conteos (córners, tarjetas): binomial negativa con media `mu` y dispersión `r`
 * (varianza = mu + mu²/r). Con `r` muy grande se comporta como Poisson.
 */
export function nbOverProb(mu: number, r: number, line: number): number {
  if (!(mu > 0)) return 0;
  const p = r / (r + mu);
  // log del primer término para evitar desbordes con r enorme
  let logV = r * Math.log(p);
  let cdf = 0;
  for (let k = 0; k <= Math.floor(line); k++) {
    cdf += Math.exp(logV);
    logV += Math.log((k + r) / (k + 1)) + Math.log(1 - p);
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}

/** Dispersión de una serie de totales por partido (método de momentos). */
export function dispersion(totals: number[]): number {
  if (totals.length < 10) return 1e6;
  const m = totals.reduce((a, b) => a + b, 0) / totals.length;
  const v = totals.reduce((a, b) => a + (b - m) ** 2, 0) / (totals.length - 1);
  return v > m ? (m * m) / (v - m) : 1e6;
}
