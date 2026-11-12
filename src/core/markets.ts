import { OutcomeProbs } from './types';
import { Prediction } from './model';

export type MarketGroup = '1X2' | 'Doble oportunidad' | 'Empate no apuesta' | 'Goles' | 'Ambos marcan';

export interface Selection {
  /** Identificador estable, ej. "1X2:1", "OU:2.5:over". */
  key: string;
  group: MarketGroup;
  label: string;
  probs: OutcomeProbs;
  /** Claves de las selecciones del mismo mercado (para quitar el margen a las cuotas). */
  siblings: string[];
}

function sum(matrix: number[][], pred: (i: number, j: number) => boolean): number {
  let s = 0;
  for (let i = 0; i < matrix.length; i++)
    for (let j = 0; j < matrix[i].length; j++) if (pred(i, j)) s += matrix[i][j];
  return s;
}

const simple = (p: number): OutcomeProbs => ({ win: p, push: 0, lose: 1 - p });

/** Deriva las probabilidades de todos los mercados soportados a partir de la matriz de marcadores. */
export function marketsFromPrediction(pr: Prediction): Selection[] {
  const M = pr.matrix;
  const pH = sum(M, (i, j) => i > j);
  const pD = sum(M, (i, j) => i === j);
  const pA = sum(M, (i, j) => i < j);
  const btts = sum(M, (i, j) => i > 0 && j > 0);
  const h = pr.home;
  const a = pr.away;

  const sel: Selection[] = [
    { key: '1X2:1', group: '1X2', label: `Gana ${h}`, probs: simple(pH), siblings: ['1X2:1', '1X2:X', '1X2:2'] },
    { key: '1X2:X', group: '1X2', label: 'Empate', probs: simple(pD), siblings: ['1X2:1', '1X2:X', '1X2:2'] },
    { key: '1X2:2', group: '1X2', label: `Gana ${a}`, probs: simple(pA), siblings: ['1X2:1', '1X2:X', '1X2:2'] },
    { key: 'DC:1X', group: 'Doble oportunidad', label: `${h} o empate (1X)`, probs: simple(pH + pD), siblings: [] },
    { key: 'DC:X2', group: 'Doble oportunidad', label: `${a} o empate (X2)`, probs: simple(pA + pD), siblings: [] },
    { key: 'DC:12', group: 'Doble oportunidad', label: 'Cualquiera gana (12)', probs: simple(pH + pA), siblings: [] },
    {
      key: 'DNB:1',
      group: 'Empate no apuesta',
      label: `${h} (empate devuelve)`,
      probs: { win: pH, push: pD, lose: pA },
      siblings: ['DNB:1', 'DNB:2'],
    },
    {
      key: 'DNB:2',
      group: 'Empate no apuesta',
      label: `${a} (empate devuelve)`,
      probs: { win: pA, push: pD, lose: pH },
      siblings: ['DNB:1', 'DNB:2'],
    },
  ];

  for (const line of [0.5, 1.5, 2.5, 3.5]) {
    const over = sum(M, (i, j) => i + j > line);
    const keys = [`OU:${line}:over`, `OU:${line}:under`];
    sel.push({ key: keys[0], group: 'Goles', label: `Más de ${line} goles`, probs: simple(over), siblings: keys });
    sel.push({ key: keys[1], group: 'Goles', label: `Menos de ${line} goles`, probs: simple(1 - over), siblings: keys });
  }

  sel.push({ key: 'BTTS:yes', group: 'Ambos marcan', label: 'Ambos marcan: Sí', probs: simple(btts), siblings: ['BTTS:yes', 'BTTS:no'] });
  sel.push({ key: 'BTTS:no', group: 'Ambos marcan', label: 'Ambos marcan: No', probs: simple(1 - btts), siblings: ['BTTS:yes', 'BTTS:no'] });
  return sel;
}

/** Los marcadores más probables, ordenados. */
export function topScores(pr: Prediction, n = 5): { score: string; p: number }[] {
  const all: { score: string; p: number }[] = [];
  pr.matrix.forEach((row, i) => row.forEach((p, j) => all.push({ score: `${i}-${j}`, p })));
  return all.sort((x, y) => y.p - x.p).slice(0, n);
}
