/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitLambdasToMarket, scoreMatrix } from '../src/picks/marketFit';

const sumWhere = (m: number[][], f: (i: number, j: number) => boolean) =>
  m.reduce((s, r, i) => s + r.reduce((t, v, j) => t + (f(i, j) ? v : 0), 0), 0);

function marketFrom(lh: number, la: number) {
  const m = scoreMatrix(lh, la);
  return {
    home: sumWhere(m, (i, j) => i > j),
    draw: sumWhere(m, (i, j) => i === j),
    away: sumWhere(m, (i, j) => i < j),
    over25: sumWhere(m, (i, j) => i + j > 2.5),
  };
}

test('scoreMatrix suma 1', () => {
  const total = scoreMatrix(1.4, 1.1).flat().reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test('fitLambdasToMarket recupera los goles esperados con 1X2 y más/menos 2.5', () => {
  const { lh, la } = fitLambdasToMarket(marketFrom(1.8, 0.9));
  assert.ok(Math.abs(lh - 1.8) < 0.05, `lh=${lh}`);
  assert.ok(Math.abs(la - 0.9) < 0.05, `la=${la}`);
});

test('fitLambdasToMarket funciona solo con 1X2', () => {
  const { home, draw, away } = marketFrom(1.8, 0.9);
  const { lh, la } = fitLambdasToMarket({ home, draw, away });
  assert.ok(Math.abs(lh - 1.8) < 0.15 && Math.abs(la - 0.9) < 0.15, `lh=${lh} la=${la}`);
});

test('visitante favorito da más goles al visitante', () => {
  const { lh, la } = fitLambdasToMarket({ home: 0.17, draw: 0.25, away: 0.58, over25: 0.45 });
  assert.ok(la > lh);
});
