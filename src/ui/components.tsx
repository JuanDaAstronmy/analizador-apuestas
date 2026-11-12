import React, { ReactNode, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle, FlatList } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { C } from './theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function T({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.text, style]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
}) {
  const bg = kind === 'primary' ? C.accent : kind === 'danger' ? C.badDim : 'transparent';
  const fg = kind === 'primary' ? '#06140a' : kind === 'danger' ? C.bad : C.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: bg, borderColor: kind === 'ghost' ? C.border : bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.chip, o.value === value && s.chipOn]}>
          <Text style={[s.chipText, o.value === value && { color: C.bg }]}>{o.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Campo numérico que acepta coma o punto decimal. */
export function NumField({
  value,
  onChange,
  placeholder,
  width = 80,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  width?: number;
}) {
  const [txt, setTxt] = useState(value !== undefined ? String(value) : '');
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    const parsed = parseFloat(txt.replace(',', '.'));
    if (value !== (isFinite(parsed) ? parsed : undefined)) setTxt(value !== undefined ? String(value) : '');
  }
  return (
    <TextInput
      value={txt}
      onChangeText={(t) => {
        setTxt(t);
        const v = parseFloat(t.replace(',', '.'));
        const nv = isFinite(v) ? v : undefined;
        setLast(nv);
        onChange(nv);
      }}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      style={[s.input, { width }]}
    />
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

export function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** Barra apilada local / empate / visitante. */
export function ProbBar({ p }: { p: [number, number, number] }) {
  const cols = [C.home, C.draw, C.away];
  return (
    <View>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' }}>
        {p.map((v, i) => (
          <View key={i} style={{ flex: Math.max(v, 0.001), backgroundColor: cols[i] }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {p.map((v, i) => (
          <Text key={i} style={{ color: cols[i], fontSize: 13, fontWeight: '600' }}>
            {['1', 'X', '2'][i]} {(v * 100).toFixed(0)} %
          </Text>
        ))}
      </View>
    </View>
  );
}

export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

/** Gráfica de línea simple (bankroll). */
export function LineChart({ series, height = 140, base }: { series: { data: number[]; color: string; width?: number }[]; height?: number; base?: number }) {
  const [w, setW] = useState(300);
  const all = series.flatMap((x) => x.data).concat(base !== undefined ? [base] : []);
  if (!series.some((x) => x.data.length >= 2)) return <Muted>La gráfica aparece cuando liquides tu primera apuesta.</Muted>;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      <Svg width={w} height={height}>
        {base !== undefined && <Line x1={0} x2={w} y1={y(base)} y2={y(base)} stroke={C.border} strokeDasharray="4 4" />}
        {series.map((sr, k) => (
          <Polyline
            key={k}
            fill="none"
            stroke={sr.color}
            strokeWidth={sr.width ?? 2}
            points={sr.data.map((v, i) => `${(i / Math.max(sr.data.length - 1, 1)) * w},${y(v)}`).join(' ')}
          />
        ))}
      </Svg>
    </View>
  );
}

/** Selector en modal con buscador (para elegir equipos). */
export function Picker({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[s.input, { flex: 1, justifyContent: 'center' }]}>
        <Text style={{ color: value ? C.text : C.muted }}>{value ?? label}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: C.bg, padding: 16, paddingTop: 48 }}>
          <TextInput value={q} onChangeText={setQ} placeholder="Buscar…" placeholderTextColor={C.muted} style={[s.input, { width: '100%', marginBottom: 12 }]} />
          <FlatList
            data={list}
            keyExtractor={(x) => x}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                  setQ('');
                }}
                style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}
              >
                <Text style={{ color: C.text, fontSize: 16 }}>{item}</Text>
              </Pressable>
            )}
          />
          <Button label="Cerrar" kind="ghost" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, gap: 8 },
  title: { color: C.text, fontSize: 17, fontWeight: '700' },
  text: { color: C.text, fontSize: 14 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 18 },
  btn: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1 },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  btnText: { fontWeight: '700', fontSize: 15 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: C.text, borderColor: C.text },
  chipText: { color: C.text, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: C.card2,
    color: C.text,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    minHeight: 40,
  },
  stat: { flexGrow: 1, flexBasis: '30%', backgroundColor: C.card2, borderRadius: 10, padding: 10 },
  statLabel: { color: C.muted, fontSize: 12 },
  statValue: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 2 },
});
