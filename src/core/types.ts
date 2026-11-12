/** Cuotas decimales de mercado para un partido (cuando la fuente las trae). */
export interface MatchOdds {
  home?: number;
  draw?: number;
  away?: number;
  over25?: number;
  under25?: number;
}

/** Un partido jugado (con goles) o por jugar (sin goles). */
export interface Match {
  date: Date;
  league: string;
  home: string;
  away: string;
  hg?: number; // goles local
  ag?: number; // goles visitante
  odds?: MatchOdds;
}

export type PlayedMatch = Match & { hg: number; ag: number };

export function isPlayed(m: Match): m is PlayedMatch {
  return typeof m.hg === 'number' && typeof m.ag === 'number' && !isNaN(m.hg) && !isNaN(m.ag);
}

/** Resultado posible de una apuesta simple: gana, se devuelve (push) o pierde. */
export interface OutcomeProbs {
  win: number;
  push: number;
  lose: number;
}

export type RiskProfileId = 'conservador' | 'moderado';

export interface RiskProfile {
  id: RiskProfileId;
  label: string;
  /** Probabilidad mínima (ajustada) de ganar para considerar una apuesta. */
  minProb: number;
  /** Cuota máxima aceptada. */
  maxOdds: number;
  /** Valor esperado mínimo por peso apostado (0.03 = +3 %). */
  minEdge: number;
  /** Fracción de Kelly (0.25 = un cuarto de Kelly). */
  kellyFraction: number;
  /** Tope de stake por apuesta como fracción del bankroll. */
  maxStakePct: number;
  /** Exposición máxima abierta (apuestas pendientes) como fracción del bankroll. */
  maxOpenExposurePct: number;
  /** Pérdida máxima diaria como fracción del bankroll. */
  dailyLossLimitPct: number;
  /** Caída desde el máximo histórico que activa la pausa. */
  maxDrawdownPct: number;
}

export const RISK_PROFILES: Record<RiskProfileId, RiskProfile> = {
  conservador: {
    id: 'conservador',
    label: 'Conservador',
    minProb: 0.5,
    maxOdds: 2.1,
    minEdge: 0.03,
    kellyFraction: 0.25,
    maxStakePct: 0.02,
    maxOpenExposurePct: 0.06,
    dailyLossLimitPct: 0.05,
    maxDrawdownPct: 0.2,
  },
  moderado: {
    id: 'moderado',
    label: 'Moderado',
    minProb: 0.4,
    maxOdds: 3.0,
    minEdge: 0.02,
    kellyFraction: 0.33,
    maxStakePct: 0.03,
    maxOpenExposurePct: 0.1,
    dailyLossLimitPct: 0.08,
    maxDrawdownPct: 0.3,
  },
};
