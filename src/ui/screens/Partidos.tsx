import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { LEAGUES } from '../../data/leagues';
import { predict } from '../../core/model';
import { Button, Card, Chips, Muted, Picker, ProbBar, Row, T, Title } from '../components';
import { C, fmtDate } from '../theme';
import { matchId, refOddsFromMatch, useStore } from '../store';

export function PartidosScreen() {
  const { settings, setSettings, data, load, loadDemo, loading, error, analyze } = useStore();
  const [home, setHome] = useState<string>();
  const [away, setAway] = useState<string>();

  const teams = useMemo(() => (data ? Object.keys(data.model.teams).sort() : []), [data]);
  const fixtures = useMemo(() => {
    if (!data) return [];
    return data.fixtures
      .filter((f) => data.model.teams[f.home] && data.model.teams[f.away])
      .map((f) => {
        const pr = predict(data.model, f.home, f.away);
        let p1 = 0, pX = 0, p2 = 0;
        pr.matrix.forEach((r, i) => r.forEach((v, j) => (i > j ? (p1 += v) : i === j ? (pX += v) : (p2 += v))));
        return { f, p: [p1, pX, p2] as [number, number, number], quality: pr.dataQuality };
      });
  }, [data]);

  const lastPlayed = data?.history[data.history.length - 1]?.date;

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <Title>Liga</Title>
        <Chips
          options={LEAGUES.map((l) => ({ value: l.code, label: `${l.name}` }))}
          value={settings.leagueCode}
          onChange={(v) => setSettings({ leagueCode: v })}
        />
        <Row>
          <View style={{ flex: 1 }}>
            <Button label={data && !data.demo ? 'Actualizar datos' : 'Descargar datos'} onPress={() => load(settings.leagueCode)} disabled={loading || settings.leagueCode === 'DEMO'} />
          </View>
          <Button label="Demo" kind="ghost" onPress={loadDemo} />
        </Row>
        {loading && <ActivityIndicator color={C.accent} />}
        {error && <T style={{ color: C.bad }}>{error}</T>}
        {data && (
          <Muted>
            {data.league.name}: {data.history.length} partidos históricos (hasta {lastPlayed ? fmtDate(lastPlayed) : '—'}),{' '}
            {Object.keys(data.model.teams).length} equipos. Ventaja de local ×{data.model.homeAdv.toFixed(2)}, ρ = {data.model.rho}.
            {data.demo ? ' Datos simulados: solo para probar la app.' : ''}
          </Muted>
        )}
        {!data && !loading && (
          <Muted>
            Los datos vienen de football-data.co.uk: resultados de las últimas 3 temporadas y las cuotas del mercado. La Liga BetPlay
            (Colombia) no está en esa fuente: para partidos colombianos se puede agregar un proveedor con API key más adelante.
          </Muted>
        )}
      </Card>

      {data && (
        <Card>
          <Title>Analizar un partido</Title>
          <Row>
            <Picker label="Local" value={home} options={teams} onChange={setHome} />
            <Picker label="Visitante" value={away} options={teams} onChange={setAway} />
          </Row>
          <Button
            label="Analizar"
            disabled={!home || !away || home === away}
            onPress={() => analyze({ id: matchId(data.league.code, home!, away!), league: data.league.code, home: home!, away: away! })}
          />
        </Card>
      )}

      {data && (
        <Card>
          <Title>Próximos partidos</Title>
          {fixtures.length === 0 && <Muted>La fuente todavía no publica la próxima jornada de esta liga (lo hace pocos días antes, y no hay en fechas FIFA). Mientras tanto usa “Analizar un partido”.</Muted>}
          {fixtures.map(({ f, p, quality }) => (
            <Pressable
              key={`${f.home}-${f.away}-${f.date.toISOString()}`}
              onPress={() =>
                analyze({
                  id: matchId(f.league, f.home, f.away, f.date),
                  league: data.league.code,
                  home: f.home,
                  away: f.away,
                  date: f.date.toISOString(),
                  refOdds: refOddsFromMatch(f),
                })
              }
              style={({ pressed }) => ({ paddingVertical: 10, borderTopWidth: 1, borderColor: C.border, opacity: pressed ? 0.6 : 1, gap: 6 })}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ fontWeight: '600', flex: 1 }}>
                  {f.home} vs {f.away}
                </T>
                <Muted>{fmtDate(f.date)}</Muted>
              </Row>
              <ProbBar p={p} />
              {quality === 'baja' && <Muted style={{ color: C.warn }}>Pocos datos de algún equipo (recién ascendido): predicción poco fiable.</Muted>}
            </Pressable>
          ))}
        </Card>
      )}
    </View>
  );
}
