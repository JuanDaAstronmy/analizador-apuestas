import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { RISK_PROFILES, RiskProfileId } from '../../core/types';
import { runBacktest, DEFAULT_BACKTEST, BacktestResult } from '../../core/backtest';
import { simulateBankroll, SimResult } from '../../core/montecarlo';
import { teamTable } from '../../core/model';
import { Button, Card, Chips, LineChart, Muted, NumField, Row, Stat, T, Title } from '../components';
import { C, money, pct } from '../theme';
import { useStore } from '../store';

export function ModeloScreen() {
  const { settings, setSettings, profile, data } = useStore();
  const [bt, setBt] = useState<BacktestResult>();
  const [btErr, setBtErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState<SimResult>();
  const [simP, setSimP] = useState({ pWin: 0.55, odds: 1.85, nBets: 200 });

  const runBt = () => {
    if (!data) return;
    setBusy(true);
    setBtErr(undefined);
    // Dejar que se pinte el indicador antes del cálculo pesado.
    setTimeout(() => {
      try {
        const cutoff = Date.now() - 4 * 365 * 86400000;
        setBt(
          runBacktest(
            data.history.filter((m) => m.date.getTime() >= cutoff),
            { ...DEFAULT_BACKTEST, profile, modelWeight: settings.modelWeight, startBankroll: settings.startBankroll },
          ),
        );
      } catch (e) {
        setBtErr(e instanceof Error ? e.message : String(e));
      }
      setBusy(false);
    }, 50);
  };

  const runSim = () => {
    const b = simP.odds - 1;
    const k = Math.max(0, (simP.pWin * b - (1 - simP.pWin)) / b);
    const stakePct = Math.min(k * profile.kellyFraction, profile.maxStakePct) || profile.maxStakePct / 2;
    setSim(simulateBankroll({ startBankroll: settings.startBankroll, nBets: simP.nBets, pWin: simP.pWin, odds: simP.odds, stakePct, nSims: 3000 }));
  };

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Title>Ajustes</Title>
        <Row style={{ justifyContent: 'space-between' }}>
          <T>Bankroll inicial</T>
          <NumField value={settings.startBankroll} onChange={(v) => setSettings({ startBankroll: v ?? 0 })} width={120} />
        </Row>
        <T>Perfil de riesgo</T>
        <Chips
          options={Object.values(RISK_PROFILES).map((p) => ({ value: p.id, label: p.label }))}
          value={settings.profileId}
          onChange={(v: RiskProfileId) => setSettings({ profileId: v })}
        />
        <Muted>
          {profile.label}: prob. mínima {pct(profile.minProb)}, cuota máx. {profile.maxOdds.toFixed(2)}, ventaja mínima {pct(profile.minEdge)},{' '}
          {profile.kellyFraction === 0.25 ? '¼' : '⅓'} de Kelly, tope {pct(profile.maxStakePct)} por apuesta.
        </Muted>
        <Row style={{ justifyContent: 'space-between' }}>
          <T style={{ flex: 1 }}>Confianza en el modelo: {pct(settings.modelWeight)}</T>
          <Button small kind="ghost" label="−" onPress={() => setSettings({ modelWeight: Math.max(0, Math.round((settings.modelWeight - 0.05) * 100) / 100) })} />
          <Button small kind="ghost" label="+" onPress={() => setSettings({ modelWeight: Math.min(1, Math.round((settings.modelWeight + 0.05) * 100) / 100) })} />
        </Row>
        <Muted>
          En los backtests con datos reales (Premier, Argentina, Brasil y México) el modelo predice algo peor que las cuotas de cierre del mercado.
          Por eso se recomienda una confianza baja (30–40 %): así solo aparecen como recomendadas las apuestas donde el modelo y el precio
          coinciden en que hay valor.
        </Muted>
      </Card>

      <Card>
        <Title>Backtest (¿le habría ganado al mercado?)</Title>
        <Muted>
          Recorre la historia semana a semana: ajusta el modelo solo con partidos anteriores, predice los siguientes y simula tus reglas de
          apuesta con las cuotas de cierre reales. Así no se usa información del futuro.
        </Muted>
        <Button label={data ? `Correr backtest: ${data.league.name}` : 'Primero carga una liga'} onPress={runBt} disabled={!data || busy} />
        {busy && <ActivityIndicator color={C.accent} />}
        {btErr && <T style={{ color: C.bad }}>{btErr}</T>}
        {bt && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Stat label="Partidos predichos" value={String(bt.nPredicted)} />
              <Stat label="Log-loss modelo" value={bt.logLossModel.toFixed(3)} />
              <Stat
                label="Log-loss mercado"
                value={bt.logLossMarket?.toFixed(3) ?? '—'}
                color={bt.logLossMarket !== undefined && bt.logLossMarket < bt.logLossModel ? C.warn : C.accent}
              />
              <Stat label="Apuestas" value={String(bt.bets.length)} />
              <Stat label="Aciertos" value={pct(bt.hitRate, 1)} />
              <Stat label="ROI" value={pct(bt.roi, 1)} color={bt.roi >= 0 ? C.accent : C.bad} />
              <Stat label="Bankroll final" value={money(bt.finalBankroll)} />
              <Stat label="Caída máxima" value={pct(bt.maxDrawdown, 1)} />
            </View>
            <LineChart series={[{ data: bt.curve, color: bt.finalBankroll >= settings.startBankroll ? C.accent : C.bad }]} base={settings.startBankroll} />
            <Muted>
              Log-loss: menor es mejor. Si el del mercado es menor, el mercado predice mejor que el modelo, y las “ventajas” que encuentre
              el modelo son en buena parte ruido. Las cuotas de cierre de Pinnacle son mucho más justas que las de BetPlay, así que en
              BetPlay el resultado real suele ser peor.
            </Muted>
            <T style={{ fontWeight: '700', marginTop: 4 }}>Calibración (predicho → observado)</T>
            {bt.calibration.map((c) => (
              <Muted key={c.bin}>
                {c.bin}: {pct(c.predicted)} → {pct(c.observed)} (n={c.n})
              </Muted>
            ))}
          </>
        )}
      </Card>

      <Card>
        <Title>Simulador Monte Carlo</Title>
        <Muted>¿Qué le pasa a tu bankroll en {simP.nBets} apuestas si de verdad aciertas con esta probabilidad? (stake según tu perfil)</Muted>
        <Row style={{ justifyContent: 'space-between' }}>
          <T>Prob. real de acierto</T>
          <NumField value={simP.pWin} onChange={(v) => setSimP({ ...simP, pWin: v ?? 0.5 })} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T>Cuota promedio</T>
          <NumField value={simP.odds} onChange={(v) => setSimP({ ...simP, odds: v ?? 2 })} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T>Número de apuestas</T>
          <NumField value={simP.nBets} onChange={(v) => setSimP({ ...simP, nBets: Math.max(1, Math.round(v ?? 100)) })} />
        </Row>
        <Button label="Simular 3.000 escenarios" onPress={runSim} />
        {sim && (
          <>
            <LineChart
              series={[...sim.samplePaths.slice(0, 15).map((d) => ({ data: d, color: '#8b98a555', width: 1 })), { data: sim.medianPath, color: C.accent, width: 3 }]}
              base={settings.startBankroll}
              height={160}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Stat label="Peor 5 %" value={money(sim.percentiles.p5)} color={C.bad} />
              <Stat label="Mediana" value={money(sim.percentiles.p50)} />
              <Stat label="Mejor 5 %" value={money(sim.percentiles.p95)} color={C.accent} />
              <Stat label="Prob. terminar perdiendo" value={pct(sim.probLoss)} />
              <Stat label="Prob. caída ≥ 30 %" value={pct(sim.probDrawdown30)} />
              <Stat label="Caída máx. típica" value={pct(sim.medianMaxDrawdown)} />
            </View>
            <Muted>
              Valor esperado por apuesta: {pct(simP.pWin * (simP.odds - 1) - (1 - simP.pWin), 1)}. Si es negativo, ninguna gestión de bankroll
              lo vuelve rentable: solo hace que pierdas más despacio.
            </Muted>
          </>
        )}
      </Card>

      {data && (
        <Card>
          <Title>Fuerza de los equipos</Title>
          <Muted>Ataque &gt; 1 marca más que el promedio; defensa = goles que recibe frente a un ataque promedio.</Muted>
          {teamTable(data.model).map((t, i) => (
            <Row key={t.name} style={{ justifyContent: 'space-between' }}>
              <T style={{ flex: 1 }}>
                {i + 1}. {t.name}
              </T>
              <Muted>
                atq {t.attack.toFixed(2)} · def {t.defense.toFixed(2)} · {t.matches} PJ
              </Muted>
            </Row>
          ))}
        </Card>
      )}

      <Card>
        <Title>Juego responsable</Title>
        <Muted>
          Apuesta solo dinero que puedas perder sin que te afecte. No persigas pérdidas aumentando el stake y respeta las pausas que marca la
          app. Si sientes que apostar deja de ser un pasatiempo, busca apoyo profesional.
        </Muted>
      </Card>
    </View>
  );
}
