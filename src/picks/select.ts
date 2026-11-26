import type { Candidate } from './candidates';

export interface ChooseOptions {
  minOdds: number;
  maxOdds: number;
  minProb: number;
  max: number;
  perMatch: number;
}

export const DEFAULT_CHOOSE: ChooseOptions = { minOdds: 1.2, maxOdds: 1.6, minProb: 0.7, max: 10, perMatch: 2 };

/**
 * Elige las apuestas más seguras dentro del rango de cuota útil.
 * Orden: probabilidad; desempate por margen de seguridad (prob − 1/cuota).
 * Variedad: en una primera pasada cada tipo de mercado aporta como máximo 3 apuestas;
 * si faltan cupos, se completan con las mejores restantes.
 */
export function choosePicks(cands: Candidate[], o: ChooseOptions = DEFAULT_CHOOSE): Candidate[] {
  const ok = cands
    .filter((c) => c.refOdds >= o.minOdds && c.refOdds <= o.maxOdds && c.prob >= o.minProb)
    .sort((a, b) => b.prob - a.prob || b.prob - 1 / b.refOdds - (a.prob - 1 / a.refOdds));
  const chosen: Candidate[] = [];
  const perMatch = new Map<string, number>();
  const perMarket = new Map<string, number>();
  const tryAdd = (c: Candidate, marketCap: number) => {
    if (chosen.length >= o.max || chosen.includes(c)) return;
    if ((perMatch.get(c.matchId) ?? 0) >= o.perMatch || (perMarket.get(c.market) ?? 0) >= marketCap) return;
    chosen.push(c);
    perMatch.set(c.matchId, (perMatch.get(c.matchId) ?? 0) + 1);
    perMarket.set(c.market, (perMarket.get(c.market) ?? 0) + 1);
  };
  for (const c of ok) tryAdd(c, 3);
  for (const c of ok) tryAdd(c, Infinity);
  return chosen.sort((a, b) => b.prob - a.prob);
}

const BOGOTA_OFFSET_MS = 5 * 3600 * 1000; // Colombia: UTC−5 todo el año
const DAY = 86400000;

export type WindowKind = 'lunes' | 'jueves' | 'martes' | 'viernes';

/** [días desde hoy hasta el inicio, duración en días] de cada ventana. */
const WINDOWS: Record<WindowKind, [number, number]> = {
  lunes: [0, 4], // lunes → jueves
  jueves: [1, 3], // viernes → domingo
  martes: [0, 3], // martes → jueves
  viernes: [0, 4], // viernes → lunes
};

/** Ventana de partidos del archivo, en hora de Colombia. */
export function windowFor(kind: WindowKind, today: Date): { from: Date; to: Date } {
  const local = new Date(today.getTime() - BOGOTA_OFFSET_MS);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const [offset, days] = WINDOWS[kind];
  const startLocal = midnightLocalAsUtc + offset * DAY;
  const from = new Date(startLocal + BOGOTA_OFFSET_MS);
  return { from, to: new Date(from.getTime() + days * DAY - 1) };
}
