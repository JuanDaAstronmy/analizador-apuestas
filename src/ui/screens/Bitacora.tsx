import React from 'react';
import { Alert, View } from 'react-native';
import { betProfit, checkLimits, BetStatus } from '../../core/bankroll';
import { Badge, Button, Card, LineChart, Muted, NumField, Row, Stat, T, Title } from '../components';
import { C, fmtDate, money, pct, signedMoney } from '../theme';
import { useStore } from '../store';

export function BitacoraScreen() {
  const { bets, stats, profile, updateBet, removeBet } = useStore();
  const lim = checkLimits(stats, profile, 0);
  const settle = (id: string, status: BetStatus) => updateBet(id, { status, settledAt: status === 'pendiente' ? undefined : new Date().toISOString() });

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Title>Bankroll</Title>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Stat label="Actual" value={money(stats.current)} />
          <Stat label="Resultado" value={signedMoney(stats.profit)} color={stats.profit >= 0 ? C.accent : C.bad} />
          <Stat label="ROI (plata propia)" value={pct(stats.roi, 1)} color={stats.roi >= 0 ? C.accent : C.bad} />
          <Stat label="Aciertos" value={`${stats.won}/${stats.won + stats.lost}`} />
          <Stat label="Caída actual" value={pct(stats.drawdown, 1)} color={stats.drawdown > profile.maxDrawdownPct / 2 ? C.warn : undefined} />
          <Stat label="Caída máxima" value={pct(stats.maxDrawdown, 1)} />
          <Stat label="Ganancia esperada" value={signedMoney(stats.expectedProfit)} />
          <Stat label="Pendiente" value={money(stats.openExposure)} />
          <Stat label="CLV promedio" value={stats.avgClv === undefined ? '—' : pct(stats.avgClv, 1)} color={stats.avgClv && stats.avgClv > 0 ? C.accent : undefined} />
        </View>
        <LineChart series={[{ data: stats.curve, color: C.accent }]} base={stats.startBankroll} />
        <Muted>
          “Ganancia esperada” es lo que el modelo esperaba ganar. Si el resultado real queda muy por debajo durante muchas apuestas, el modelo
          está sobreestimando su ventaja. El CLV compara tu cuota con la de cierre: si es positivo de forma constante, estás apostando a buen
          precio, y es la señal más confiable de que la estrategia funciona.
        </Muted>
      </Card>

      <Card style={{ borderColor: lim.allowed ? C.border : C.bad }}>
        <Title>Límites ({profile.label})</Title>
        <Muted>
          Máx. {pct(profile.maxStakePct)} del bankroll por apuesta · máx. {pct(profile.maxOpenExposurePct)} pendiente a la vez · pérdida diaria
          máx. {pct(profile.dailyLossLimitPct)} · pausa si caes {pct(profile.maxDrawdownPct)} desde el máximo.
        </Muted>
        {lim.allowed ? (
          <T style={{ color: C.accent }}>Puedes apostar hasta {money(lim.maxStake)} ahora mismo.</T>
        ) : (
          lim.warnings.map((w) => (
            <T key={w} style={{ color: C.bad }}>
              {w}
            </T>
          ))
        )}
        {stats.freeBetProfit > 0 && <Muted>Ganado con apuestas gratis: {money(stats.freeBetProfit)}</Muted>}
      </Card>

      <Card>
        <Title>Apuestas ({bets.length})</Title>
        {bets.length === 0 && <Muted>Aún no registras apuestas. Regístralas desde Analizar o Bono.</Muted>}
        {bets.map((b) => (
          <View key={b.id} style={{ borderTopWidth: 1, borderColor: C.border, paddingTop: 8, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700', flex: 1 }}>
                {b.selectionLabel} @ {b.odds.toFixed(2)}
              </T>
              {b.isFreeBet && <Badge label="bono" color={C.blue} bg="#58a6ff33" />}
            </Row>
            <Muted>
              {b.matchLabel} · {fmtDate(b.createdAt)} · {money(b.stake)}
              {b.prob ? ` · prob. ${pct(b.prob)}` : ''}
            </Muted>
            {b.status === 'pendiente' ? (
              <Row style={{ flexWrap: 'wrap' }}>
                <Button small label="Ganada" onPress={() => settle(b.id, 'ganada')} />
                <Button small kind="danger" label="Perdida" onPress={() => settle(b.id, 'perdida')} />
                <Button small kind="ghost" label="Devuelta" onPress={() => settle(b.id, 'devuelta')} />
                <Button
                  small
                  kind="ghost"
                  label="Borrar"
                  onPress={() => Alert.alert('Borrar apuesta', '¿Seguro?', [{ text: 'No' }, { text: 'Borrar', style: 'destructive', onPress: () => removeBet(b.id) }])}
                />
              </Row>
            ) : (
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ color: b.status === 'ganada' ? C.accent : b.status === 'perdida' ? C.bad : C.muted }}>
                  {b.status} {signedMoney(betProfit(b))}
                </T>
                <Button small kind="ghost" label="Deshacer" onPress={() => settle(b.id, 'pendiente')} />
              </Row>
            )}
            <Row>
              <Muted>Cuota de cierre (opcional):</Muted>
              <NumField value={b.closingOdds} onChange={(v) => updateBet(b.id, { closingOdds: v })} placeholder="—" width={70} />
            </Row>
          </View>
        ))}
      </Card>
    </View>
  );
}
