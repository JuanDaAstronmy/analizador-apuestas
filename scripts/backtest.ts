/// <reference types="node" />
/**
 * Backtest desde la terminal con CSV de football-data.co.uk.
 *   npx tsx scripts/backtest.ts [--perfil conservador|moderado] [--peso 0.5] archivo1.csv archivo2.csv ...
 */
import { readFileSync } from 'node:fs';
import { parseMatchesCsv } from '../src/core/csv';
import { runBacktest, DEFAULT_BACKTEST } from '../src/core/backtest';
import { RISK_PROFILES, RiskProfileId } from '../src/core/types';

const args = process.argv.slice(2);
let profile: RiskProfileId = 'conservador';
let weight = 0.5;
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--perfil') profile = args[++i] as RiskProfileId;
  else if (args[i] === '--peso') weight = parseFloat(args[++i]);
  else files.push(args[i]);
}
const matches = files.flatMap((f) => parseMatchesCsv(readFileSync(f, 'utf8'))).sort((a, b) => a.date.getTime() - b.date.getTime());
// Para ligas "new" con muchos años, usamos solo los últimos 4 años.
const cutoff = matches.length ? matches[matches.length - 1].date.getTime() - 4 * 365 * 86400000 : 0;
const recent = matches.filter((m) => m.date.getTime() >= cutoff);

const t = Date.now();
const r = runBacktest(recent, {
  ...DEFAULT_BACKTEST,
  profile: RISK_PROFILES[profile],
  modelWeight: weight,
  startBankroll: 100000,
});
const pct = (x: number) => (x * 100).toFixed(1) + ' %';
console.log(`Partidos: ${recent.length}, predichos: ${r.nPredicted}, con cuotas: ${r.nWithOdds} (${Date.now() - t} ms)`);
console.log(`Log-loss 1X2  modelo ${r.logLossModel.toFixed(4)} | mercado ${r.logLossMarket?.toFixed(4)} | mezcla ${r.logLossBlend?.toFixed(4)}`);
console.log(`Brier  1X2    modelo ${r.brierModel.toFixed(4)} | mercado ${r.brierMarket?.toFixed(4)}`);
console.log('Calibración (predicho → observado, n):');
for (const c of r.calibration) console.log(`  ${c.bin.padEnd(10)} ${pct(c.predicted).padStart(7)} → ${pct(c.observed).padStart(7)}  (${c.n})`);
console.log(
  `Apuestas (${profile}, peso modelo ${weight}): ${r.bets.length}, aciertos ${pct(r.hitRate)}, ROI ${pct(r.roi)}, ` +
    `bankroll 100000 → ${r.finalBankroll.toFixed(0)}, caída máx ${pct(r.maxDrawdown)}`,
);
