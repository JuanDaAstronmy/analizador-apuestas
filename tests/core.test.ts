/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchesCsv } from '../src/core/csv';
import { fitModel, predict } from '../src/core/model';
import { marketsFromPrediction } from '../src/core/markets';
import { expectedValue, fairProbs, kelly, logGrowth, rankBets, evaluateBet, fairOdds } from '../src/core/betting';
import { freeBetOptions, FreeBetLeg } from '../src/core/freebet';
import { computeStats, checkLimits, BetRecord } from '../src/core/bankroll';
import { runBacktest, DEFAULT_BACKTEST } from '../src/core/backtest';
import { simulateBankroll } from '../src/core/montecarlo';
import { syntheticLeague } from '../src/core/synthetic';
import { RISK_PROFILES } from '../src/core/types';
import { seasonCode, filterFixtureRows, LEAGUES, candidateUrls } from '../src/data/leagues';

const close = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} ≉ ${b}`);

test('parsea ambos formatos de football-data.co.uk', () => {
  const main =
    'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,PSH,PSD,PSA,PSCH,PSCD,PSCA,Avg>2.5,Avg<2.5\n' +
    'E0,15/08/2025,20:00,Liverpool,Bournemouth,4,2,H,1.3,6,9,1.29,6.5,9.7,1.36,3.2\n';
  const [m] = parseMatchesCsv(main);
  assert.equal(m.home, 'Liverpool');
  assert.equal(m.hg, 4);
  assert.equal(m.odds?.home, 1.29); // prefiere cierre de Pinnacle
  assert.equal(m.odds?.over25, 1.36);
  assert.equal(m.date.getUTCFullYear(), 2025);

  const nw = '﻿Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,PSCD,PSCA\nArgentina,Liga Profesional ,2012/2013,03/08/2012,23:00,Arsenal Sarandi,Union,1,0,H,1.9,3.39,5.03\n';
  const [n] = parseMatchesCsv(nw);
  assert.equal(n.away, 'Union');
  assert.equal(n.ag, 0);
  assert.equal(n.odds?.away, 5.03);

  const fixture = 'Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A\nB1,06/11/2026,19:45,Standard,Beveren,1.9,3.5,3.5\n';
  const [f] = parseMatchesCsv(fixture);
  assert.equal(f.hg, undefined);
  assert.equal(f.odds?.draw, 3.5);
});

test('el modelo recupera las fuerzas verdaderas de una liga sintética', () => {
  const { matches, truth, homeAdv } = syntheticLeague({ seasons: 4, seed: 3 });
  const model = fitModel(matches, { halfLifeDays: 5000, shrinkage: 0.5 });
  close(model.homeAdv, homeAdv, 0.08, `ventaja local ${model.homeAdv}`);
  // Correlación entre ataque estimado y verdadero.
  const names = Object.keys(truth);
  const corr = (x: number[], y: number[]) => {
    const mx = x.reduce((a, b) => a + b) / x.length;
    const my = y.reduce((a, b) => a + b) / y.length;
    let sxy = 0, sxx = 0, syy = 0;
    x.forEach((v, i) => {
      sxy += (v - mx) * (y[i] - my);
      sxx += (v - mx) ** 2;
      syy += (y[i] - my) ** 2;
    });
    return sxy / Math.sqrt(sxx * syy);
  };
  assert.ok(corr(names.map((n) => model.teams[n].attack), names.map((n) => truth[n].attack)) > 0.85);
  assert.ok(corr(names.map((n) => model.teams[n].defense), names.map((n) => truth[n].defense)) > 0.85);
});

test('las probabilidades de los mercados son coherentes', () => {
  const { matches } = syntheticLeague();
  const model = fitModel(matches);
  const pr = predict(model, 'Equipo A', 'Equipo T');
  const total = pr.matrix.flat().reduce((a, b) => a + b, 0);
  close(total, 1, 1e-9);
  const s = Object.fromEntries(marketsFromPrediction(pr).map((x) => [x.key, x.probs]));
  close(s['1X2:1'].win + s['1X2:X'].win + s['1X2:2'].win, 1, 1e-9);
  close(s['DC:1X'].win, s['1X2:1'].win + s['1X2:X'].win, 1e-12);
  close(s['DNB:1'].push, s['1X2:X'].win, 1e-12);
  assert.ok(s['OU:1.5:over'].win > s['OU:2.5:over'].win);
  assert.ok(s['1X2:1'].win > 0.6, 'el más fuerte de local debe ser favorito claro');
});

test('valor esperado, Kelly y cuota justa', () => {
  const p = { win: 0.55, push: 0, lose: 0.45 };
  close(expectedValue(p, 2), 0.1, 1e-12);
  close(kelly(p, 2), 0.1, 1e-12); // (0.55·1 − 0.45)/1
  close(fairOdds(p), 1 / 0.55, 1e-12);
  assert.equal(kelly({ win: 0.4, push: 0, lose: 0.6 }, 2), 0);
  // Kelly maximiza el crecimiento log.
  const g = (f: number) => logGrowth(p, 2, f);
  assert.ok(g(0.1) > g(0.05) && g(0.1) > g(0.15));
  // Con devolución (empate no apuesta).
  const dnb = { win: 0.45, push: 0.3, lose: 0.25 };
  close(kelly(dnb, 1.8), (0.45 * 0.8 - 0.25) / (0.8 * 0.7), 1e-12);
  const fp = fairProbs([2, 3.5, 4]);
  close(fp.reduce((a, b) => a + b), 1, 1e-12);
});

test('el perfil conservador filtra y limita el stake', () => {
  const sel = { key: '1X2:1', group: '1X2' as const, label: 'Local', probs: { win: 0.6, push: 0, lose: 0.4 }, siblings: [] };
  const e = evaluateBet(sel, 1.9, RISK_PROFILES.conservador, 1);
  assert.equal(e.verdict, 'recomendada');
  assert.ok(e.stakePct <= RISK_PROFILES.conservador.maxStakePct + 1e-12);
  const long = evaluateBet({ ...sel, probs: { win: 0.4, push: 0, lose: 0.6 } }, 3.2, RISK_PROFILES.conservador, 1);
  assert.equal(long.verdict, 'fuera de perfil'); // tiene valor pero es arriesgada
  assert.equal(long.stakePct, 0);
  const bad = evaluateBet(sel, 1.5, RISK_PROFILES.conservador, 1);
  assert.equal(bad.verdict, 'sin valor');
});

test('mezclar con el mercado reduce ventajas ilusorias', () => {
  const { matches } = syntheticLeague();
  const pr = predict(fitModel(matches), 'Equipo C', 'Equipo K');
  const sels = marketsFromPrediction(pr);
  const p1 = sels[0].probs.win;
  // Mercado que cree que el local tiene 10 puntos menos de probabilidad.
  const odds = { '1X2:1': 1 / (p1 - 0.1) / 1.05, '1X2:X': 3.6, '1X2:2': 4.5 };
  const pure = rankBets(sels, odds, RISK_PROFILES.moderado, 1).find((e) => e.selection.key === '1X2:1')!;
  const mixed = rankBets(sels, odds, RISK_PROFILES.moderado, 0.3).find((e) => e.selection.key === '1X2:1')!;
  assert.ok(mixed.ev < pure.ev);
});

test('free bet: respeta la cuota mínima y calcula el valor', () => {
  const legs: FreeBetLeg[] = [
    { matchId: 'a', matchLabel: 'A', selectionKey: '1X2:1', selectionLabel: 'A gana', odds: 2.3, probs: { win: 0.45, push: 0, lose: 0.55 } },
    { matchId: 'b', matchLabel: 'B', selectionKey: '1X2:1', selectionLabel: 'B gana', odds: 1.5, probs: { win: 0.68, push: 0, lose: 0.32 } },
    { matchId: 'c', matchLabel: 'C', selectionKey: '1X2:1', selectionLabel: 'C gana', odds: 1.55, probs: { win: 0.66, push: 0, lose: 0.34 } },
    { matchId: 'd', matchLabel: 'D', selectionKey: 'X', selectionLabel: 'Empate', odds: 1.4, probs: { win: 0.7, push: 0, lose: 0.3 } },
  ];
  const r = freeBetOptions(legs, { stake: 10000, minOdds: 2.2, stakeReturned: false, allowDoubles: true });
  for (const o of [...r.byValue, ...r.bySafety]) assert.ok(o.odds >= 2.2);
  const single = r.byValue.find((o) => o.legs.length === 1)!;
  close(single.expectedValue, 0.45 * 1.3 * 10000, 1e-6);
  // La combinada B+C (0.68·0.66 ≈ 0.449) no llega; B+... la más segura debe ser la de mayor p.
  assert.ok(r.bySafety[0].pWin >= r.bySafety[1].pWin);
  const noDoubles = freeBetOptions(legs, { stake: 10000, minOdds: 2.2, stakeReturned: false, allowDoubles: false });
  assert.equal(noDoubles.total, 1);
});

test('bitácora: estadísticas y límites', () => {
  const b = (o: Partial<BetRecord>): BetRecord => ({
    id: Math.random().toString(),
    createdAt: '2026-11-01T10:00:00Z',
    matchLabel: 'X vs Y',
    selectionLabel: 'X',
    odds: 2,
    stake: 2000,
    isFreeBet: false,
    status: 'pendiente',
    ...o,
  });
  const bets = [
    b({ status: 'ganada', settledAt: '2026-11-01T12:00:00Z', ev: 0.05 }),
    b({ status: 'perdida', settledAt: '2026-11-02T12:00:00Z', ev: 0.05 }),
    b({ status: 'perdida', settledAt: '2026-11-03T12:00:00Z', isFreeBet: true, stake: 10000, odds: 2.2 }),
    b({ status: 'pendiente', stake: 1500 }),
  ];
  const s = computeStats(bets, 100000, new Date('2026-11-03T15:00:00Z'));
  assert.equal(s.current, 100000);
  assert.equal(s.staked, 4000);
  assert.equal(s.openExposure, 1500);
  assert.equal(s.won, 1);
  const lim = checkLimits(s, RISK_PROFILES.conservador, 3000);
  assert.ok(lim.warnings.length > 0); // 3000 > 2 % de 100000
  assert.equal(lim.maxStake, 2000);
  const crashed = computeStats([b({ status: 'perdida', stake: 30000, settledAt: '2026-10-01T00:00:00Z' })], 100000);
  assert.equal(checkLimits(crashed, RISK_PROFILES.conservador, 100).allowed, false);
});

test('backtest walk-forward corre y el modelo supera a una predicción ingenua', () => {
  const { matches } = syntheticLeague({ seasons: 3, seed: 11 });
  // Cuotas "de mercado" = probabilidades uniformes con margen (mercado ingenuo).
  for (const m of matches) m.odds = { home: 2.7, draw: 2.7, away: 2.7 };
  const r = runBacktest(matches, { ...DEFAULT_BACKTEST, profile: RISK_PROFILES.conservador, modelWeight: 1, startBankroll: 1000 });
  assert.ok(r.nPredicted > 500);
  assert.ok(r.logLossModel < r.logLossMarket!, 'el modelo debe ganarle a probabilidades uniformes');
});

test('Monte Carlo: apuesta sin ventaja pierde en mediana y es reproducible', () => {
  const prm = { startBankroll: 1000, nBets: 300, pWin: 0.5, odds: 1.9, stakePct: 0.02, nSims: 2000, seed: 1 };
  const a = simulateBankroll(prm);
  const b = simulateBankroll(prm);
  assert.equal(a.percentiles.p50, b.percentiles.p50);
  assert.ok(a.percentiles.p50 < 1000);
  assert.ok(a.probLoss > 0.6);
});

test('utilidades de ligas', () => {
  assert.equal(seasonCode(new Date(2026, 10, 12)), '2627');
  assert.equal(seasonCode(new Date(2026, 2, 1)), '2526');
  const arg = LEAGUES.find((l) => l.code === 'ARG')!;
  assert.equal(filterFixtureRows([{ Country: 'Argentina' }, { Country: 'Mexico' }], arg).length, 1);
});

test('las descargas prueban primero la copia en GitHub', () => {
  const urls = candidateUrls('https://football-data.co.uk/mmz4281/2627/E0.csv');
  assert.equal(urls.length, 2);
  assert.ok(urls[0].endsWith('/releases/download/datos/mmz4281_2627_E0.csv'));
  assert.equal(urls[1], 'https://football-data.co.uk/mmz4281/2627/E0.csv');
});
