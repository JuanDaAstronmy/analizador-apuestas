import { Match, PlayedMatch, isPlayed, RiskProfile } from './types';
import { fitModel, predict, FittedModel, ModelOptions } from './model';
import { marketsFromPrediction } from './markets';
import { fairProbs, rankBets } from './betting';

/**
 * Backtest "walk-forward": recorre la historia en orden; para cada semana ajusta
 * el modelo SOLO con partidos anteriores y predice los de esa semana. Así se mide
 * cómo le habría ido al modelo de verdad, sin mirar el futuro.
 *
 * Se compara contra el mercado (cuotas de cierre sin margen). Si el modelo no le
 * gana al mercado en log-loss, es una señal clara de que las "ventajas" que
 * encuentra son en su mayoría ruido — por eso la app mezcla ambas probabilidades.
 */
export interface BacktestParams {
  profile: RiskProfile;
  modelWeight: number;
  startBankroll: number;
  /** Número mínimo de partidos previos antes de empezar a evaluar. */
  warmupMatches: number;
  refitDays: number;
  modelOptions?: Partial<ModelOptions>;
  /** Apostar como máximo a una selección por partido (la mejor). */
  onePerMatch: boolean;
}

export const DEFAULT_BACKTEST: Omit<BacktestParams, 'profile' | 'modelWeight' | 'startBankroll'> = {
  warmupMatches: 200,
  refitDays: 7,
  onePerMatch: true,
};

export interface BacktestBet {
  date: Date;
  match: string;
  selection: string;
  odds: number;
  prob: number;
  stake: number;
  profit: number;
}

export interface BacktestResult {
  nPredicted: number;
  /** Log-loss promedio del resultado 1X2 (menor es mejor). */
  logLossModel: number;
  logLossMarket?: number;
  logLossBlend?: number;
  brierModel: number;
  brierMarket?: number;
  nWithOdds: number;
  /** Calibración: por tramos de probabilidad predicha vs frecuencia observada. */
  calibration: { bin: string; predicted: number; observed: number; n: number }[];
  bets: BacktestBet[];
  finalBankroll: number;
  roi: number;
  hitRate: number;
  maxDrawdown: number;
  curve: number[];
}

const DAY = 86400000;
const clampP = (p: number) => Math.min(Math.max(p, 1e-6), 1 - 1e-6);

export function runBacktest(matches: Match[], prm: BacktestParams): BacktestResult {
  const played = matches.filter(isPlayed).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (played.length <= prm.warmupMatches + 10)
    throw new Error(`Se necesitan más de ${prm.warmupMatches + 10} partidos jugados para el backtest.`);

  let llM = 0, llK = 0, llB = 0, brM = 0, brK = 0;
  let nPred = 0, nOdds = 0;
  const calBins = Array.from({ length: 10 }, () => ({ sp: 0, so: 0, n: 0 }));
  const bets: BacktestBet[] = [];
  let bank = prm.startBankroll;
  let peak = bank;
  let maxDD = 0;
  const curve = [bank];
  let staked = 0;

  let i = prm.warmupMatches;
  while (i < played.length) {
    const blockStart = played[i].date.getTime();
    const blockEnd = blockStart + prm.refitDays * DAY;
    const block: PlayedMatch[] = [];
    while (i < played.length && played[i].date.getTime() < blockEnd) block.push(played[i++]);

    const history = played.filter((m) => m.date.getTime() < blockStart);
    let model: FittedModel;
    try {
      model = fitModel(history, { ...prm.modelOptions, asOf: new Date(blockStart - 1), maxIter: 100, tol: 1e-5 });
    } catch {
      continue;
    }

    // Las apuestas de la semana se dimensionan con el bankroll al inicio de la semana.
    const bankAtStart = bank;
    for (const m of block) {
      const th = model.teams[m.home];
      const ta = model.teams[m.away];
      if (!th || !ta || th.matches < 5 || ta.matches < 5) continue;
      const pr = predict(model, m.home, m.away);
      const sels = marketsFromPrediction(pr);
      const p1 = sels[0].probs.win, pX = sels[1].probs.win, p2 = sels[2].probs.win;
      const outcome = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2;
      const pm = [p1, pX, p2];
      nPred++;
      llM += -Math.log(clampP(pm[outcome]));
      brM += pm.reduce((s, p, k) => s + (p - (k === outcome ? 1 : 0)) ** 2, 0);
      pm.forEach((p, k) => {
        const b = Math.min(9, Math.floor(p * 10));
        calBins[b].sp += p;
        calBins[b].so += k === outcome ? 1 : 0;
        calBins[b].n += 1;
      });

      const o = m.odds;
      if (!o?.home || !o.draw || !o.away) continue;
      nOdds++;
      const pk = fairProbs([o.home, o.draw, o.away]);
      llK += -Math.log(clampP(pk[outcome]));
      brK += pk.reduce((s, p, k) => s + (p - (k === outcome ? 1 : 0)) ** 2, 0);
      const pb = pm.map((p, k) => prm.modelWeight * p + (1 - prm.modelWeight) * pk[k]);
      llB += -Math.log(clampP(pb[outcome]));

      // Simulación de apuestas con las reglas del perfil de riesgo.
      const oddsByKey: Record<string, number | undefined> = {
        '1X2:1': o.home,
        '1X2:X': o.draw,
        '1X2:2': o.away,
        'OU:2.5:over': o.over25,
        'OU:2.5:under': o.under25,
      };
      const ranked = rankBets(sels, oddsByKey, prm.profile, prm.modelWeight).filter((e) => e.verdict === 'recomendada');
      for (const e of prm.onePerMatch ? ranked.slice(0, 1) : ranked) {
        const stake = e.stakePct * bankAtStart;
        if (stake <= 0) continue;
        const k = e.selection.key;
        const goals = m.hg + m.ag;
        const won =
          (k === '1X2:1' && outcome === 0) ||
          (k === '1X2:X' && outcome === 1) ||
          (k === '1X2:2' && outcome === 2) ||
          (k === 'OU:2.5:over' && goals > 2.5) ||
          (k === 'OU:2.5:under' && goals < 2.5);
        const profit = won ? stake * (e.odds - 1) : -stake;
        bank += profit;
        staked += stake;
        peak = Math.max(peak, bank);
        maxDD = Math.max(maxDD, (peak - bank) / peak);
        curve.push(bank);
        bets.push({
          date: m.date,
          match: `${m.home} vs ${m.away}`,
          selection: e.selection.label,
          odds: e.odds,
          prob: e.adjProbs.win,
          stake,
          profit,
        });
      }
    }
  }

  const wins = bets.filter((b) => b.profit > 0).length;
  return {
    nPredicted: nPred,
    logLossModel: llM / Math.max(nPred, 1),
    logLossMarket: nOdds ? llK / nOdds : undefined,
    logLossBlend: nOdds ? llB / nOdds : undefined,
    brierModel: brM / Math.max(nPred, 1),
    brierMarket: nOdds ? brK / nOdds : undefined,
    nWithOdds: nOdds,
    calibration: calBins
      .map((c, k) => ({
        bin: `${k * 10}-${k * 10 + 10} %`,
        predicted: c.n ? c.sp / c.n : 0,
        observed: c.n ? c.so / c.n : 0,
        n: c.n,
      }))
      .filter((c) => c.n > 0),
    bets,
    finalBankroll: bank,
    roi: staked > 0 ? (bank - prm.startBankroll) / staked : 0,
    hitRate: bets.length ? wins / bets.length : 0,
    maxDrawdown: maxDD,
    curve,
  };
}
