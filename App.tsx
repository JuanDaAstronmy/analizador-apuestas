import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StoreProvider, TabId, useStore } from './src/ui/store';
import { C, money } from './src/ui/theme';
import { PartidosScreen } from './src/ui/screens/Partidos';
import { AnalizarScreen } from './src/ui/screens/Analizar';
import { BonoScreen } from './src/ui/screens/Bono';
import { BitacoraScreen } from './src/ui/screens/Bitacora';
import { ModeloScreen } from './src/ui/screens/Modelo';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'partidos', label: 'Partidos', icon: '⚽' },
  { id: 'analizar', label: 'Analizar', icon: '📊' },
  { id: 'bono', label: 'Bono', icon: '🎁' },
  { id: 'bitacora', label: 'Bitácora', icon: '📒' },
  { id: 'modelo', label: 'Modelo', icon: '⚙️' },
];

function Main() {
  const { ready, tab, setTab, stats, profile } = useStore();
  if (!ready)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  const Screen = { partidos: PartidosScreen, analizar: AnalizarScreen, bono: BonoScreen, bitacora: BitacoraScreen, modelo: ModeloScreen }[tab];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>Analizador</Text>
        <Text style={{ color: C.muted, fontSize: 13 }}>
          {profile.label} · <Text style={{ color: C.text, fontWeight: '700' }}>{money(stats.current)}</Text>
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Screen />
      </ScrollView>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ fontSize: 18, opacity: tab === t.id ? 1 : 0.5 }}>{t.icon}</Text>
            <Text style={{ color: tab === t.id ? C.accent : C.muted, fontSize: 11, fontWeight: '600' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="light" />
        <StoreProvider>
          <Main />
        </StoreProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
