import React, { useMemo, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { predict } from '../../core/model';
import { marketsFromPrediction } from '../../core/markets';
import { blend, marketProbsFor } from '../../core/betting';
import { freeBetOptions, FreeBetLeg, FreeBetOption } from '../../core/freebet';
import { Button, Card, Chips, Muted, NumField, Row, T, Title } from '../components';
import { C, money, pct } from '../theme';
import { matchId, refOddsFromMatch, useStore } from '../store';

type Mode = 'seguridad' | 'valor';

export function BonoScreen() {
  const { settings, setSettings, analyzed, leagues, oddsBook, addBet } = useStore();
  const fb = settings.freeBet;
  const [mode, setMode] = useState<Mode>('seguridad');
  const [useRef, setUseRef] = useState(false);

  const result = useMemo(() => {
    const legs: FreeBetLeg[] = [];
    const seen = new Set<string>();
    const add = (id: string, league: string, home: string, away: string, odds: Record<string, number | undefined>, ref?: Record<string, number | undefined>) => {
      const lg = leagues[league];
      if (seen.has(id) || !lg?.model.teams[home] || !lg.model.teams[away]) return;
      seen.add(id);
      const sels = marketsFromPrediction(predict(lg.model, home, away));
      for (const s of sels) {
        const o = odds[s.key];
        if (!o || o <= 1) continue;
        const market = (ref && marketProbsFor(s, ref)) ?? marketProbsFor(s, odds);
        legs.push({
          matchId: id,
          matchLabel: `${home} vs ${away}`,
          selectionKey: s.key,
          selectionLabel: s.label,
          odds: o,
          probs: blend(s.probs, market, settings.modelWeight),
        });
      }
    };
    for (const m of analyzed) add(m.id, m.league, m.home, m.away, oddsBook[m.id] ?? {}, m.refOdds);
    if (useRef)
      for (const lg of Object.values(leagues))
        for (const f of lg.fixtures) {
          const ref = refOddsFromMatch(f);
          if (ref) add(matchId(f.league, f.home, f.away, f.date), lg.league.code, f.home, f.away, ref, ref);
        }
    return { ...freeBetOptions(legs, fb), nLegs: legs.length };
  }, [analyzed, leagues, oddsBook, fb, settings.modelWeight, useRef]);

  const list = mode === 'seguridad' ? result.bySafety : result.byValue;

  const register = (o: FreeBetOption) => {
    addBet({
      matchLabel: o.legs.map((l) => l.matchLabel).join(' + '),
      selectionLabel: o.legs.map((l) => l.selectionLabel).join(' + '),
      odds: Math.round(o.odds * 100) / 100,
      stake: fb.stake,
      isFreeBet: true,
      prob: o.pWin,
    });
    Alert.alert('Registrada', 'La apuesta gratis quedó en la bitácora como pendiente.');
  };

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Title>Apuesta gratis</Title>
        <Muted>
          En una apuesta gratis normalmente no te devuelven el valor del bono: si ganas cobras solo la ganancia, valor × (cuota − 1). No
          arriesgas plata tuya, así que la decisión es entre más probabilidad de cobrar algo o más valor esperado.
        </Muted>
        <Row style={{ justifyContent: 'space-between' }}>
          <T>Valor del bono</T>
          <NumField value={fb.stake} onChange={(v) => setSettings({ freeBet: { ...fb, stake: v ?? 0 } })} width={110} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T>Cuota mínima exigida</T>
          <NumField value={fb.minOdds} onChange={(v) => setSettings({ freeBet: { ...fb, minOdds: v ?? 1.01 } })} width={110} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T style={{ flex: 1 }}>Permitir combinadas de 2 partidos</T>
          <Switch value={fb.allowDoubles} onValueChange={(v) => setSettings({ freeBet: { ...fb, allowDoubles: v } })} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T style={{ flex: 1 }}>La casa devuelve el valor del bono al ganar</T>
          <Switch value={fb.stakeReturned} onValueChange={(v) => setSettings({ freeBet: { ...fb, stakeReturned: v } })} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <T style={{ flex: 1 }}>Incluir próximos partidos con cuotas de referencia (no son de BetPlay)</T>
          <Switch value={useRef} onValueChange={setUseRef} />
        </Row>
        <Muted>
          Revisa las condiciones de tu bono: algunos no permiten combinadas o exigen una cuota mínima por selección.
        </Muted>
      </Card>

      <Card>
        <Chips
          options={[
            { value: 'seguridad', label: 'Más probable de cobrar' },
            { value: 'valor', label: 'Más valor esperado' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {result.total === 0 && (
          <Muted>
            No hay opciones con cuota ≥ {fb.minOdds}. Analiza partidos e ingresa las cuotas de BetPlay (pestaña Analizar), o activa las cuotas de
            referencia. Tienes {result.nLegs} selecciones con cuota.
          </Muted>
        )}
        {list.map((o, i) => (
          <View key={i} style={{ borderTopWidth: 1, borderColor: C.border, paddingTop: 8, gap: 4 }}>
            {o.legs.map((l) => (
              <T key={l.matchId + l.selectionKey}>
                <T style={{ fontWeight: '700' }}>{l.selectionLabel}</T> @ {l.odds.toFixed(2)} <T style={{ color: C.muted }}>· {l.matchLabel}</T>
              </T>
            ))}
            <Row style={{ justifyContent: 'space-between' }}>
              <Muted>
                Cuota {o.odds.toFixed(2)} · prob. {pct(o.pWin, 1)} · cobras {money((fb.stakeReturned ? o.odds : o.odds - 1) * fb.stake)}
              </Muted>
              <Button small kind="ghost" label="Registrar" onPress={() => register(o)} />
            </Row>
            <Muted style={{ color: C.accent }}>
              Valor esperado {money(o.expectedValue)} ({pct(o.conversion)} del bono)
            </Muted>
          </View>
        ))}
      </Card>
    </View>
  );
}
