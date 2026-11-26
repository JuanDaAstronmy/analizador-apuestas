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

import { teamGames, weightedMean, streaks, streakWeight } from '../src/picks/teamForm';

const row = (d: string, h: string, a: string, hg: string, ag: string, extra: Record<string, string> = {}) =>
  ({ Date: d, HomeTeam: h, AwayTeam: a, FTHG: hg, FTAG: ag, ...extra });

test('weightedMean: 50 % últimos 3, 30 % del 4 al 8, 20 % resto', () => {
  assert.ok(Math.abs(weightedMean([3, 3, 3, 0, 0, 0, 0, 0, 0, 0]) - 1.5) < 1e-9);
  assert.equal(weightedMean([2]), 2);
  assert.ok(Number.isNaN(weightedMean([])));
});

test('streaks cuenta rachas desde el partido más reciente', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((d) => row(`0${d}/11/2026`, 'Inter', 'X' + d, '2', '0'));
  rows.push(row('20/10/2026', 'Inter', 'Y', '0', '1'));
  const g = teamGames(rows, 'Inter', new Date('2026-11-20'));
  assert.equal(g.length, 7);
  assert.equal(g[0].date.getUTCDate(), 6);
  const s = streaks(g);
  assert.equal(s.gana, 6);
  assert.equal(s.noPierde, 6);
  assert.equal(s.sinRecibir, 6);
  assert.equal(s.pierde, 0);
});

test('streakWeight: nada antes de 5, satura en 10+', () => {
  assert.equal(streakWeight(4), 0);
  assert.ok(streakWeight(5) > 0);
  assert.equal(streakWeight(10), 1);
  assert.equal(streakWeight(15), 1);
});

test('teamGames lee córners, tarjetas, xG y árbitro, ignora filas sin goles y partidos futuros', () => {
  const rows = [
    row('01/11/2026', 'Leeds', 'Hull', '1', '1', { HC: '7', AC: '3', HY: '2', HR: '1', AY: '1', AR: '0', HxG: '1.4', AxG: '0.6', Referee: 'A Taylor' }),
    row('05/11/2026', 'Hull', 'Leeds', '', ''),
    row('25/11/2026', 'Hull', 'Leeds', '3', '0'),
  ];
  const g = teamGames(rows, 'Hull', new Date('2026-11-20'));
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].home, g[0].gf, g[0].ga, g[0].cf, g[0].ca, g[0].cardsFor, g[0].cardsAgainst, g[0].xgf, g[0].ref], [false, 1, 1, 3, 7, 1, 3, 0.6, 'A Taylor']);
});
