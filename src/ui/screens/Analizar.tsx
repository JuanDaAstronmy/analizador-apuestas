import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { predict } from '../../core/model';
import { marketsFromPrediction, topScores, MarketGroup } from '../../core/markets';
import { rankBets, fairOdds, BetEvaluation } from '../../core/betting';
import { checkLimits } from '../../core/bankroll';
import { Badge, Button, Card, Muted, NumField, ProbBar, Row, T, Title } from '../components';
import { C, fmtDate, money, pct } from '../theme';
import { useStore } from '../store';

const GROUPS: MarketGroup[] = ['1X2', 'Doble oportunidad', 'Empate no apuesta', 'Goles', 'Ambos marcan'];

export function AnalizarScreen() {
  const { current, leagues, oddsBook, setOdds, profile, settings, stats, addBet } = useStore();
  const [showAll, setShowAll] = useState(false);
  const lg = current ? leagues[current.league] : undefined;

  const analysis = useMemo(() => {
    if (!current || !lg || !lg.model.teams[current.home] || !lg.model.teams[current.away]) return undefined;
    const pr = predict(lg.model, current.home, current.away);
    return { pr, sels: marketsFromPrediction(pr), scores: topScores(pr, 6) };
  }, [current, lg]);

  if (!current) return <Muted>Elige un partido en la pestaña “Partidos”.</Muted>;
  if (!analysis)
    return <Muted>Carga la liga de este partido ({current.league}) en “Partidos” para ver el análisis.</Muted>;

  const { pr, sels, scores } = analysis;
  const entered = oddsBook[current.id] ?? {};
  const ranked = rankBets(sels, entered, profile, settings.modelWeight, current.refOdds);
  const p1 = sels.find((s) => s.key === '1X2:1')!.probs.win;
  const pX = sels.find((s) => s.key === '1X2:X')!.probs.win;
  const p2 = sels.find((s) => s.key === '1X2:2')!.probs.win;

  const register = (e: BetEvaluation) => {
    const stake = Math.round(e.stakePct * stats.current);
    const lim = checkLimits(stats, profile, stake);
    const doIt = () =>
      addBet({
        matchLabel: `${current.home} vs ${current.away}`,
        matchDate: current.date,
        selectionLabel: e.selection.label,
        odds: e.odds,
        stake: Math.min(stake, Math.floor(lim.maxStake)),
        isFreeBet: false,
        prob: e.adjProbs.win,
        ev: e.ev,
      });
    if (!lim.allowed) return Alert.alert('Límite activado', lim.warnings.join('\n\n'));
    if (lim.warnings.length) return Alert.alert('Atención', lim.warnings.join('\n\n') + '\n\nSe registrará el stake máximo permitido.', [{ text: 'Cancelar' }, { text: 'Registrar', onPress: doIt }]);
    doIt();
    Alert.alert('Registrada', `Apuesta de ${money(Math.min(stake, lim.maxStake))} añadida a la bitácora (pendiente).`);
  };

  const visible = showAll ? ranked : ranked.filter((e) => e.verdict !== 'sin valor');

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Title>
          {current.home} vs {current.away}
        </Title>
        {current.date && <Muted>{fmtDate(current.date)}</Muted>}
        <ProbBar p={[p1, pX, p2]} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>
            Goles esperados: {pr.lambdaHome.toFixed(2)} – {pr.lambdaAway.toFixed(2)}
          </Muted>
          <Badge
            label={`Datos: ${pr.dataQuality}`}
            color={pr.dataQuality === 'alta' ? C.accent : pr.dataQuality === 'media' ? C.warn : C.bad}
            bg={pr.dataQuality === 'alta' ? C.accentDim : pr.dataQuality === 'media' ? C.warnDim : C.badDim}
          />
        </Row>
        <Muted>Marcadores más probables: {scores.map((x) => `${x.score} (${pct(x.p)})`).join(' · ')}</Muted>
      </Card>

      <Card>
        <Title>Cuotas de BetPlay</Title>
        <Muted>
          Escribe las cuotas que ves en BetPlay. “Justa” es la cuota mínima a la que, según el modelo, la apuesta deja de perder dinero
          a largo plazo. {current.refOdds ? '“Mercado” es el promedio de otras casas (sirve de referencia).' : ''}
        </Muted>
        {GROUPS.map((g) => (
          <View key={g} style={{ gap: 6, marginTop: 6 }}>
            <T style={{ color: C.muted, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' }}>{g}</T>
            {sels
              .filter((x) => x.group === g)
              .map((x) => (
                <Row key={x.key} style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <T>{x.label}</T>
                    <Muted>
                      Modelo {pct(x.probs.win)}
                      {x.probs.push ? ` (+${pct(x.probs.push)} devuelve)` : ''} · justa {fairOdds(x.probs).toFixed(2)}
                      {current.refOdds?.[x.key] ? ` · mercado ${current.refOdds[x.key]!.toFixed(2)}` : ''}
                    </Muted>
                  </View>
                  <NumField value={entered[x.key]} onChange={(v) => setOdds(current.id, x.key, v)} placeholder="cuota" width={74} />
                </Row>
              ))}
          </View>
        ))}
      </Card>

      <Card>
        <Title>Recomendaciones ({profile.label})</Title>
        <Muted>
          Ordenadas por crecimiento esperado del bankroll (criterio de Kelly). La probabilidad usada mezcla {pct(settings.modelWeight)} modelo y{' '}
          {pct(1 - settings.modelWeight)} mercado, porque el mercado suele ser más preciso que cualquier modelo simple.
        </Muted>
        {ranked.length === 0 && <Muted>Ingresa al menos una cuota para evaluar.</Muted>}
        {visible.map((e) => (
          <View key={e.selection.key} style={{ borderTopWidth: 1, borderColor: C.border, paddingTop: 8, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700', flex: 1 }}>
                {e.selection.label} @ {e.odds.toFixed(2)}
              </T>
              <Badge
                label={e.verdict}
                color={e.verdict === 'recomendada' ? C.accent : e.verdict === 'fuera de perfil' ? C.warn : C.bad}
                bg={e.verdict === 'recomendada' ? C.accentDim : e.verdict === 'fuera de perfil' ? C.warnDim : C.badDim}
              />
            </Row>
            <Muted>
              Prob. ajustada {pct(e.adjProbs.win, 1)}
              {e.marketProbs ? ` (mercado ${pct(e.marketProbs.win, 1)})` : ''} · valor esperado {e.ev >= 0 ? '+' : ''}
              {pct(e.ev, 1)}
            </Muted>
            {e.verdict === 'recomendada' && (
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ color: C.accent }}>
                  Stake sugerido: {money(e.stakePct * stats.current)} ({pct(e.stakePct, 1)} del bankroll)
                </T>
                <Button small label="Registrar" onPress={() => register(e)} />
              </Row>
            )}
            {e.reasons.length > 0 && <Muted>{e.reasons.join(' · ')}</Muted>}
          </View>
        ))}
        {ranked.length > visible.length && (
          <Button kind="ghost" small label={`Ver ${ranked.length - visible.length} sin valor`} onPress={() => setShowAll(true)} />
        )}
      </Card>
    </View>
  );
}
