import { OutcomeProbs, RiskProfile } from './types';
import { Selection } from './markets';

/** Probabilidad implícita de una cuota decimal (incluye el margen de la casa). */
export const implied = (odds: number) => 1 / odds;

/** Margen de la casa (overround) de un mercado completo: Σ 1/cuota − 1. */
export function overround(odds: number[]): number {
  return odds.reduce((s, o) => s + 1 / o, 0) - 1;
}

/** Probabilidades "justas" del mercado: quita el margen normalizando. */
export function fairProbs(odds: number[]): number[] {
  const inv = odds.map((o) => 1 / o);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((v) => v / s);
}

/** Valor esperado por peso apostado: p_gana·(c−1) − p_pierde. */
export function expectedValue(p: OutcomeProbs, odds: number): number {
  return p.win * (odds - 1) - p.lose;
}

/**
 * Fracción de Kelly completa para una apuesta con posible devolución (push).
 * Maximiza E[ln(bankroll)]: f* = (p_g·b − p_p) / (b·(p_g + p_p)), con b = cuota − 1.
 */
export function kelly(p: OutcomeProbs, odds: number): number {
  const b = odds - 1;
  if (b <= 0) return 0;
  const f = (p.win * b - p.lose) / (b * (p.win + p.lose));
  return Math.max(0, f);
}

/** Crecimiento logarítmico esperado del bankroll al apostar la fracción f. */
export function logGrowth(p: OutcomeProbs, odds: number, f: number): number {
  if (f <= 0) return 0;
  if (f >= 1) return -Infinity;
  return p.win * Math.log(1 + f * (odds - 1)) + p.lose * Math.log(1 - f);
}

/**
 * El mercado (sobre todo cerca del cierre) es difícil de superar. Por prudencia
 * mezclamos la probabilidad del modelo con la del mercado:
 *   p_ajustada = w·p_modelo + (1−w)·p_mercado
 * w = confianza en el modelo (0..1). Si no hay probabilidad de mercado se usa la del modelo.
 */
export function blend(model: OutcomeProbs, market: OutcomeProbs | undefined, w: number): OutcomeProbs {
  if (!market) return model;
  const win = w * model.win + (1 - w) * market.win;
  const push = w * model.push + (1 - w) * market.push;
  return { win, push, lose: Math.max(0, 1 - win - push) };
}

export type Verdict = 'recomendada' | 'sin valor' | 'fuera de perfil';

export interface BetEvaluation {
  selection: Selection;
  odds: number;
  modelProbs: OutcomeProbs;
  marketProbs?: OutcomeProbs;
  adjProbs: OutcomeProbs;
  ev: number;
  /** Fracción del bankroll recomendada (ya con Kelly fraccional y tope). */
  stakePct: number;
  /** Crecimiento log esperado con ese stake (criterio de ordenamiento). */
  growth: number;
  verdict: Verdict;
  reasons: string[];
}

const simple = (p: number): OutcomeProbs => ({ win: p, push: 0, lose: 1 - p });

/**
 * Probabilidades justas (sin margen) que el mercado asigna a una selección.
 * 1X2, doble oportunidad y empate-no-apuesta se derivan de las cuotas 1X2;
 * los demás mercados (goles, ambos marcan) usan las cuotas de su propio mercado.
 */
export function marketProbsFor(sel: Selection, oddsByKey: Record<string, number | undefined>): OutcomeProbs | undefined {
  const k = sel.key;
  if (k.startsWith('1X2:') || k.startsWith('DC:') || k.startsWith('DNB:')) {
    const o = ['1X2:1', '1X2:X', '1X2:2'].map((x) => oddsByKey[x]);
    if (o.some((v) => !v || v <= 1)) return undefined;
    const [h, d, a] = fairProbs(o as number[]);
    switch (k) {
      case '1X2:1': return simple(h);
      case '1X2:X': return simple(d);
      case '1X2:2': return simple(a);
      case 'DC:1X': return simple(h + d);
      case 'DC:X2': return simple(a + d);
      case 'DC:12': return simple(h + a);
      case 'DNB:1': return { win: h, push: d, lose: a };
      case 'DNB:2': return { win: a, push: d, lose: h };
    }
    return undefined;
  }
  const group = sel.siblings;
  if (group.length < 2) return undefined;
  const odds = group.map((x) => oddsByKey[x]);
  if (odds.some((o) => !o || o <= 1)) return undefined;
  return simple(fairProbs(odds as number[])[group.indexOf(k)]);
}

export function evaluateBet(
  sel: Selection,
  odds: number,
  profile: RiskProfile,
  modelWeight: number,
  marketProbs?: OutcomeProbs,
): BetEvaluation {
  const adj = blend(sel.probs, marketProbs, modelWeight);
  const ev = expectedValue(adj, odds);
  const fullKelly = kelly(adj, odds);
  const stakePct = Math.min(fullKelly * profile.kellyFraction, profile.maxStakePct);
  const reasons: string[] = [];

  // Probabilidad de "no perder" (gana o devuelve) para evaluar el riesgo.
  const safeProb = adj.win + adj.push;
  if (safeProb < profile.minProb) reasons.push(`Probabilidad ${(safeProb * 100).toFixed(0)} % < mínimo ${(profile.minProb * 100).toFixed(0)} %`);
  if (odds > profile.maxOdds) reasons.push(`Cuota ${odds.toFixed(2)} > máximo ${profile.maxOdds.toFixed(2)}`);

  let verdict: Verdict;
  if (ev < profile.minEdge || stakePct <= 0) {
    verdict = 'sin valor';
    reasons.unshift(ev < 0 ? `Valor esperado negativo (${(ev * 100).toFixed(1)} %)` : `Ventaja ${(ev * 100).toFixed(1)} % < mínimo ${(profile.minEdge * 100).toFixed(0)} %`);
  } else if (reasons.length) {
    verdict = 'fuera de perfil';
  } else {
    verdict = 'recomendada';
  }
  const finalStake = verdict === 'recomendada' ? stakePct : 0;
  return {
    selection: sel,
    odds,
    modelProbs: sel.probs,
    marketProbs,
    adjProbs: adj,
    ev,
    stakePct: finalStake,
    growth: logGrowth(adj, odds, finalStake),
    verdict,
    reasons,
  };
}

/** Evalúa todas las selecciones con cuota y las ordena: recomendadas primero, por crecimiento log. */
export function rankBets(
  selections: Selection[],
  oddsByKey: Record<string, number | undefined>,
  profile: RiskProfile,
  modelWeight: number,
  /** Cuotas de referencia (p. ej. promedio del mercado) para estimar la probabilidad del mercado. */
  refOddsByKey?: Record<string, number | undefined>,
): BetEvaluation[] {
  const out: BetEvaluation[] = [];
  for (const s of selections) {
    const o = oddsByKey[s.key];
    if (!o || o <= 1) continue;
    const market = (refOddsByKey && marketProbsFor(s, refOddsByKey)) ?? marketProbsFor(s, oddsByKey);
    out.push(evaluateBet(s, o, profile, modelWeight, market));
  }
  const order: Record<Verdict, number> = { recomendada: 0, 'fuera de perfil': 1, 'sin valor': 2 };
  return out.sort(
    (a, b) => order[a.verdict] - order[b.verdict] || b.growth - a.growth || b.ev - a.ev || b.adjProbs.win - a.adjProbs.win,
  );
}

/** Cuota justa según el modelo (la mínima a la que la apuesta deja de tener valor negativo). */
export function fairOdds(p: OutcomeProbs): number {
  // p_g·(c−1) = p_p  →  c = 1 + p_p/p_g
  return p.win > 0 ? 1 + p.lose / p.win : Infinity;
}
