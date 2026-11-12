import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Match, RISK_PROFILES, RiskProfile, RiskProfileId } from '../core/types';
import { FittedModel, fitModel } from '../core/model';
import { BetRecord, computeStats, BankrollStats } from '../core/bankroll';
import { LEAGUES, League, loadLeague } from '../data/leagues';
import { syntheticLeague } from '../core/synthetic';

export interface Settings {
  startBankroll: number;
  profileId: RiskProfileId;
  /** Peso del modelo frente al mercado (0..1). */
  modelWeight: number;
  leagueCode: string;
  freeBet: { stake: number; minOdds: number; stakeReturned: boolean; allowDoubles: boolean };
}

const DEFAULT_SETTINGS: Settings = {
  startBankroll: 200000,
  profileId: 'conservador',
  modelWeight: 0.35,
  leagueCode: 'E0',
  freeBet: { stake: 10000, minOdds: 2.2, stakeReturned: false, allowDoubles: true },
};

/** Partido en análisis. */
export interface MatchRef {
  id: string;
  league: string;
  home: string;
  away: string;
  date?: string;
  /** Cuotas de referencia de la fuente (promedio del mercado / Pinnacle). */
  refOdds?: Record<string, number | undefined>;
}

export const matchId = (league: string, home: string, away: string, date?: Date | string) =>
  `${league}|${home}|${away}|${date ? new Date(date).toISOString().slice(0, 10) : 'manual'}`;

export function refOddsFromMatch(m: Match): Record<string, number | undefined> | undefined {
  if (!m.odds) return undefined;
  return {
    '1X2:1': m.odds.home,
    '1X2:X': m.odds.draw,
    '1X2:2': m.odds.away,
    'OU:2.5:over': m.odds.over25,
    'OU:2.5:under': m.odds.under25,
  };
}

export interface LeagueState {
  league: League;
  history: Match[];
  fixtures: Match[];
  model: FittedModel;
  loadedAt: string;
  demo?: boolean;
}

interface Store {
  ready: boolean;
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  profile: RiskProfile;
  bets: BetRecord[];
  addBet: (b: Omit<BetRecord, 'id' | 'createdAt' | 'status'>) => void;
  updateBet: (id: string, patch: Partial<BetRecord>) => void;
  removeBet: (id: string) => void;
  stats: BankrollStats;
  /** Liga seleccionada (si ya está cargada). */
  data?: LeagueState;
  /** Todas las ligas cargadas en esta sesión, por código. */
  leagues: Record<string, LeagueState>;
  loading: boolean;
  error?: string;
  load: (code: string) => Promise<void>;
  loadDemo: () => void;
  current?: MatchRef;
  analyze: (m: MatchRef) => void;
  /** Cuotas ingresadas por el usuario (BetPlay) por partido y selección. */
  oddsBook: Record<string, Record<string, number | undefined>>;
  setOdds: (matchId: string, key: string, v: number | undefined) => void;
  analyzed: MatchRef[];
  tab: TabId;
  setTab: (t: TabId) => void;
}

export type TabId = 'partidos' | 'analizar' | 'bono' | 'bitacora' | 'modelo';

const Ctx = createContext<Store | null>(null);
const K = { settings: 'ap.settings.v1', bets: 'ap.bets.v1', odds: 'ap.odds.v1', analyzed: 'ap.analyzed.v1' };

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
const writeJson = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => {});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [bets, setBets] = useState<BetRecord[]>([]);
  const [oddsBook, setOddsBook] = useState<Store['oddsBook']>({});
  const [analyzed, setAnalyzed] = useState<MatchRef[]>([]);
  const [leagues, setLeagues] = useState<Record<string, LeagueState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [current, setCurrent] = useState<MatchRef>();
  const [tab, setTab] = useState<TabId>('partidos');

  useEffect(() => {
    (async () => {
      const st = await readJson(K.settings, DEFAULT_SETTINGS);
      setSettingsState({ ...DEFAULT_SETTINGS, ...st, freeBet: { ...DEFAULT_SETTINGS.freeBet, ...st.freeBet } });
      setBets(await readJson(K.bets, []));
      setOddsBook(await readJson(K.odds, {}));
      setAnalyzed(await readJson(K.analyzed, []));
      setReady(true);
    })();
  }, []);

  useEffect(() => void (ready && writeJson(K.settings, settings)), [settings, ready]);
  useEffect(() => void (ready && writeJson(K.bets, bets)), [bets, ready]);
  useEffect(() => void (ready && writeJson(K.odds, oddsBook)), [oddsBook, ready]);
  useEffect(() => void (ready && writeJson(K.analyzed, analyzed)), [analyzed, ready]);

  const setSettings = useCallback((p: Partial<Settings>) => setSettingsState((s) => ({ ...s, ...p })), []);

  const load = useCallback(async (code: string) => {
    const league = LEAGUES.find((l) => l.code === code)!;
    setLoading(true);
    setError(undefined);
    try {
      const d = await loadLeague(league);
      // El modelo se ajusta a la fecha de hoy (los pesos temporales decaen hasta hoy).
      const model = fitModel(d.history, { asOf: new Date() });
      setLeagues((m) => ({ ...m, [code]: { ...d, model } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDemo = useCallback(() => {
    const { matches } = syntheticLeague({ seasons: 3, start: new Date(Date.now() - 3 * 365 * 86400000) });
    const played = matches.filter((m) => m.date.getTime() < Date.now());
    const names = Array.from(new Set(played.map((m) => m.home)));
    const fixtures: Match[] = [];
    for (let i = 0; i < 10; i += 2)
      fixtures.push({ date: new Date(Date.now() + (i + 1) * 86400000), league: 'DEMO', home: names[i], away: names[i + 1] });
    setLeagues((m) => ({ ...m, DEMO: {
      league: { code: 'DEMO', name: 'Liga demo (datos simulados)', country: '—', kind: 'main' },
      history: played,
      fixtures,
      model: fitModel(played, { asOf: new Date() }),
      loadedAt: new Date().toISOString(),
      demo: true,
    } }));
    setSettingsState((s) => ({ ...s, leagueCode: 'DEMO' }));
    setError(undefined);
  }, []);

  const analyze = useCallback((m: MatchRef) => {
    setCurrent(m);
    setAnalyzed((a) => [m, ...a.filter((x) => x.id !== m.id)].slice(0, 30));
    setTab('analizar');
  }, []);

  const setOdds = useCallback(
    (id: string, key: string, v: number | undefined) => setOddsBook((b) => ({ ...b, [id]: { ...b[id], [key]: v } })),
    [],
  );

  const addBet: Store['addBet'] = useCallback(
    (b) =>
      setBets((list) => [
        { ...b, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), status: 'pendiente' },
        ...list,
      ]),
    [],
  );
  const updateBet = useCallback((id: string, patch: Partial<BetRecord>) => setBets((l) => l.map((b) => (b.id === id ? { ...b, ...patch } : b))), []);
  const removeBet = useCallback((id: string) => setBets((l) => l.filter((b) => b.id !== id)), []);

  const stats = useMemo(() => computeStats(bets, settings.startBankroll), [bets, settings.startBankroll]);
  const value: Store = {
    ready,
    settings,
    setSettings,
    profile: RISK_PROFILES[settings.profileId],
    bets,
    addBet,
    updateBet,
    removeBet,
    stats,
    data: leagues[settings.leagueCode],
    leagues,
    loading,
    error,
    load,
    loadDemo,
    current,
    analyze,
    oddsBook,
    setOdds,
    analyzed,
    tab,
    setTab,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fuera de StoreProvider');
  return s;
}
