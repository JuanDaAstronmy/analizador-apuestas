import { Match } from './types';
import { rng } from './montecarlo';

/** Muestra de Poisson (algoritmo de Knuth; λ es pequeño en fútbol). */
function poisson(r: () => number, lam: number): number {
  const L = Math.exp(-lam);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

/**
 * Liga sintética con fuerzas conocidas: sirve para verificar que el modelo
 * recupera los parámetros verdaderos y como "modo demo" sin internet.
 */
export function syntheticLeague(opts: { teams?: number; seasons?: number; seed?: number; homeAdv?: number; start?: Date } = {}) {
  const nT = opts.teams ?? 20;
  const r = rng(opts.seed ?? 7);
  const homeAdv = opts.homeAdv ?? 1.25;
  const names = Array.from({ length: nT }, (_, i) => `Equipo ${String.fromCharCode(65 + i)}`);
  const truth: Record<string, { attack: number; defense: number }> = {};
  names.forEach((n, i) => {
    const s = (i / (nT - 1) - 0.5) * 0.8; // de fuerte a débil
    truth[n] = { attack: Math.exp(-s + (r() - 0.5) * 0.1), defense: 1.15 * Math.exp(s + (r() - 0.5) * 0.1) };
  });
  const matches: Match[] = [];
  let day = (opts.start ?? new Date(Date.UTC(2023, 7, 1, 12))).getTime();
  for (let s = 0; s < (opts.seasons ?? 2); s++) {
    // Doble round-robin (método del círculo).
    const rot = [...names];
    const rounds: [string, string][][] = [];
    for (let k = 0; k < nT - 1; k++) {
      const round: [string, string][] = [];
      for (let i = 0; i < nT / 2; i++) round.push(k % 2 ? [rot[i], rot[nT - 1 - i]] : [rot[nT - 1 - i], rot[i]]);
      rounds.push(round);
      rot.splice(1, 0, rot.pop()!);
    }
    for (const round of [...rounds, ...rounds.map((rd) => rd.map(([h, a]) => [a, h] as [string, string]))]) {
      for (const [h, a] of round) {
        const lam = homeAdv * truth[h].attack * truth[a].defense;
        const mu = truth[a].attack * truth[h].defense;
        matches.push({ date: new Date(day), league: 'DEMO', home: h, away: a, hg: poisson(r, lam), ag: poisson(r, mu) });
      }
      day += 7 * 86400000;
    }
    day += 60 * 86400000;
  }
  return { matches, truth, homeAdv, names };
}
