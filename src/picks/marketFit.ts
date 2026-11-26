/**
 * Ajuste de goles esperados al mercado: busca los goles esperados de cada equipo
 * (λ local, λ visitante) cuyo modelo de Poisson reproduce las probabilidades que
 * dan las casas (sin margen). Así todos los demás mercados de goles salen
 * coherentes con lo que piensa el mercado.
 */

function poisson(lam: number, maxK: number): number[] {
  const p = [Math.exp(-lam)];
  for (let k = 1; k <= maxK; k++) p.push((p[k - 1] * lam) / k);
  return p;
}

/** Matriz de marcadores: m[i][j] = P(local i, visitante j). Normalizada a 1. */
export function scoreMatrix(lh: number, la: number, maxGoals = 10): number[][] {
  const ph = poisson(lh, maxGoals);
  const pa = poisson(la, maxGoals);
  let total = 0;
  const m = ph.map((a) => pa.map((b) => {
    total += a * b;
    return a * b;
  }));
  return m.map((r) => r.map((v) => v / total));
}

/** Probabilidades clave de un par de λ, calculadas sin construir la matriz completa. */
function keyProbs(lh: number, la: number) {
  const ph = poisson(lh, 10);
  const pa = poisson(la, 10);
  let home = 0, draw = 0, under = 0, total = 0;
  for (let i = 0; i <= 10; i++)
    for (let j = 0; j <= 10; j++) {
      const v = ph[i] * pa[j];
      total += v;
      if (i > j) home += v;
      else if (i === j) draw += v;
      if (i + j <= 2) under += v;
    }
  return { home: home / total, draw: draw / total, away: 1 - (home + draw) / total, over25: 1 - under / total };
}

export function fitLambdasToMarket(p: { home: number; draw: number; away: number; over25?: number }): { lh: number; la: number } {
  const err = (lh: number, la: number) => {
    const k = keyProbs(lh, la);
    let e = (k.home - p.home) ** 2 + (k.away - p.away) ** 2 + (k.draw - p.draw) ** 2;
    if (p.over25 !== undefined) e += (k.over25 - p.over25) ** 2;
    return e;
  };
  let best = { lh: 1.3, la: 1.1, e: Infinity };
  for (let lh = 0.2; lh <= 4.0001; lh += 0.05)
    for (let la = 0.2; la <= 4.0001; la += 0.05) {
      const e = err(lh, la);
      if (e < best.e) best = { lh, la, e };
    }
  // Refinamiento local.
  for (let step = 0.025; step >= 0.005; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dh, da] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const lh = best.lh + dh, la = best.la + da;
        if (lh < 0.05 || la < 0.05) continue;
        const e = err(lh, la);
        if (e < best.e) {
          best = { lh, la, e };
          improved = true;
        }
      }
    }
  }
  return { lh: best.lh, la: best.la };
}
