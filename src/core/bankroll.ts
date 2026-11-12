import { RiskProfile } from './types';

export type BetStatus = 'pendiente' | 'ganada' | 'perdida' | 'devuelta';

export interface BetRecord {
  id: string;
  createdAt: string; // ISO
  matchLabel: string;
  matchDate?: string;
  selectionLabel: string;
  odds: number;
  stake: number;
  isFreeBet: boolean;
  /** Probabilidad ajustada al momento de apostar (para calibración). */
  prob?: number;
  /** Valor esperado por peso al momento de apostar. */
  ev?: number;
  /** Cuota de cierre (para medir CLV: si la cuota bajó, tomaste buen precio). */
  closingOdds?: number;
  status: BetStatus;
  settledAt?: string;
  note?: string;
}

/** Ganancia neta de una apuesta liquidada (para free bet "stake no devuelto"). */
export function betProfit(b: BetRecord): number {
  switch (b.status) {
    case 'ganada':
      return b.stake * (b.odds - 1);
    case 'perdida':
      return b.isFreeBet ? 0 : -b.stake;
    default:
      return 0;
  }
}

export interface BankrollStats {
  startBankroll: number;
  current: number;
  peak: number;
  drawdown: number; // fracción desde el máximo
  maxDrawdown: number;
  settled: number;
  pending: number;
  openExposure: number;
  won: number;
  lost: number;
  pushed: number;
  staked: number; // dinero propio arriesgado (sin free bets)
  profit: number;
  roi: number; // profit / staked
  expectedProfit: number; // Σ EV·stake de apuestas liquidadas
  avgClv?: number; // promedio de (cuota tomada / cuota cierre − 1)
  todayLoss: number;
  /** Curva de bankroll en orden de liquidación. */
  curve: number[];
  freeBetProfit: number;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function computeStats(bets: BetRecord[], startBankroll: number, now = new Date()): BankrollStats {
  const settled = bets
    .filter((b) => b.status !== 'pendiente')
    .sort((a, b) => (a.settledAt ?? a.createdAt).localeCompare(b.settledAt ?? b.createdAt));
  let bank = startBankroll;
  let peak = bank;
  let maxDD = 0;
  const curve = [bank];
  let staked = 0;
  let expected = 0;
  let todayLoss = 0;
  let freeBetProfit = 0;
  for (const b of settled) {
    const p = betProfit(b);
    bank += p;
    curve.push(bank);
    peak = Math.max(peak, bank);
    maxDD = Math.max(maxDD, peak > 0 ? (peak - bank) / peak : 0);
    if (!b.isFreeBet && b.status !== 'devuelta') staked += b.stake;
    if (b.isFreeBet) freeBetProfit += p;
    if (b.ev !== undefined && !b.isFreeBet) expected += b.ev * b.stake;
    if (b.settledAt && sameDay(new Date(b.settledAt), now) && p < 0) todayLoss += -p;
  }
  const pending = bets.filter((b) => b.status === 'pendiente');
  const clvs = bets.filter((b) => b.closingOdds && b.closingOdds > 1).map((b) => b.odds / b.closingOdds! - 1);
  const profit = bank - startBankroll;
  return {
    startBankroll,
    current: bank,
    peak,
    drawdown: peak > 0 ? (peak - bank) / peak : 0,
    maxDrawdown: maxDD,
    settled: settled.length,
    pending: pending.length,
    openExposure: pending.filter((b) => !b.isFreeBet).reduce((s, b) => s + b.stake, 0),
    won: settled.filter((b) => b.status === 'ganada').length,
    lost: settled.filter((b) => b.status === 'perdida').length,
    pushed: settled.filter((b) => b.status === 'devuelta').length,
    staked,
    profit,
    roi: staked > 0 ? (profit - freeBetProfit) / staked : 0,
    expectedProfit: expected,
    avgClv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : undefined,
    todayLoss,
    curve,
    freeBetProfit,
  };
}

export interface LimitCheck {
  allowed: boolean;
  /** Stake máximo permitido ahora mismo por los límites. */
  maxStake: number;
  warnings: string[];
}

/** Aplica los límites de gestión de bankroll antes de registrar una apuesta con dinero propio. */
export function checkLimits(stats: BankrollStats, profile: RiskProfile, stake: number): LimitCheck {
  const warnings: string[] = [];
  const bank = stats.current;
  let allowed = true;
  if (stats.drawdown >= profile.maxDrawdownPct) {
    allowed = false;
    warnings.push(
      `Tu bankroll cayó ${(stats.drawdown * 100).toFixed(0)} % desde su máximo (límite ${(profile.maxDrawdownPct * 100).toFixed(0)} %). ` +
        'Pausa y revisa la estrategia antes de seguir.',
    );
  }
  if (stats.todayLoss >= profile.dailyLossLimitPct * bank) {
    allowed = false;
    warnings.push('Alcanzaste el límite de pérdida diaria. Mañana será otro día.');
  }
  const byStake = profile.maxStakePct * bank;
  const byExposure = Math.max(0, profile.maxOpenExposurePct * bank - stats.openExposure);
  const maxStake = Math.max(0, Math.min(byStake, byExposure));
  if (stake > byStake) warnings.push(`El stake supera el ${(profile.maxStakePct * 100).toFixed(0)} % del bankroll (máx. ${byStake.toFixed(0)}).`);
  if (stake > byExposure)
    warnings.push(`Superarías la exposición abierta máxima (${(profile.maxOpenExposurePct * 100).toFixed(0)} % del bankroll).`);
  if (stake > bank) {
    allowed = false;
    warnings.push('El stake es mayor que tu bankroll.');
  }
  return { allowed, maxStake, warnings };
}
