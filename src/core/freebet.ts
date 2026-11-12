import { OutcomeProbs } from './types';

/**
 * Optimizador de apuesta gratis (free bet).
 *
 * En una apuesta gratis tipo "stake no devuelto" (lo usual en las casas), si
 * ganas recibes solo la ganancia: stake·(cuota − 1). Si pierdes, no pierdes
 * dinero propio. Por eso:
 *
 *    valor esperado = p · (cuota − 1) · stake
 *
 * No hay riesgo para tu bankroll, así que lo racional es maximizar el valor
 * esperado; pero como prefieres seguridad, también se muestra la opción con la
 * mayor probabilidad de cobrar algo que cumpla la cuota mínima.
 */
export interface FreeBetLeg {
  matchId: string;
  matchLabel: string;
  selectionKey: string;
  selectionLabel: string;
  odds: number;
  probs: OutcomeProbs;
}

export interface FreeBetOption {
  legs: FreeBetLeg[];
  odds: number;
  pWin: number;
  /** Valor esperado en pesos. */
  expectedValue: number;
  /** Fracción del valor nominal que se convierte en dinero esperado (EV / stake). */
  conversion: number;
}

export interface FreeBetParams {
  stake: number;
  minOdds: number;
  /** Si la casa devuelve también el stake al ganar (poco común). */
  stakeReturned: boolean;
  allowDoubles: boolean;
  maxLegOdds?: number;
}

function option(legs: FreeBetLeg[], prm: FreeBetParams): FreeBetOption {
  const odds = legs.reduce((s, l) => s * l.odds, 1);
  // Para combinadas asumimos independencia entre partidos distintos.
  const pWin = legs.reduce((s, l) => s * l.probs.win, 1);
  const payoutIfWin = prm.stakeReturned ? odds * prm.stake : (odds - 1) * prm.stake;
  const ev = pWin * payoutIfWin;
  return { legs, odds, pWin, expectedValue: ev, conversion: ev / prm.stake };
}

export function freeBetOptions(candidates: FreeBetLeg[], prm: FreeBetParams) {
  // Los mercados con devolución (empate no apuesta) complican la regla del bono; se excluyen.
  const legs = candidates.filter((c) => c.probs.push === 0 && c.odds > 1);
  const singles = legs.filter((l) => l.odds >= prm.minOdds).map((l) => option([l], prm));

  const doubles: FreeBetOption[] = [];
  if (prm.allowDoubles) {
    // Para combinar usamos las patas más probables (cuotas bajas), máximo 40 para que sea rápido.
    const pool = legs
      .filter((l) => l.odds < prm.minOdds && (!prm.maxLegOdds || l.odds <= prm.maxLegOdds))
      .sort((a, b) => b.probs.win - a.probs.win)
      .slice(0, 40);
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++) {
        if (pool[i].matchId === pool[j].matchId) continue;
        if (pool[i].odds * pool[j].odds < prm.minOdds) continue;
        doubles.push(option([pool[i], pool[j]], prm));
      }
  }
  const all = [...singles, ...doubles];
  return {
    byValue: [...all].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, 10),
    bySafety: [...all].sort((a, b) => b.pWin - a.pWin || b.expectedValue - a.expectedValue).slice(0, 10),
    total: all.length,
  };
}
