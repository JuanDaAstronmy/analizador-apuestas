export const C = {
  bg: '#0d1117',
  card: '#161b22',
  card2: '#1f2630',
  border: '#2d3540',
  text: '#e6edf3',
  muted: '#8b98a5',
  accent: '#3fb950', // verde: recomendado / ganancia
  accentDim: '#23863640',
  warn: '#d29922',
  warnDim: '#d2992233',
  bad: '#f85149',
  badDim: '#f8514933',
  blue: '#58a6ff',
  home: '#58a6ff',
  draw: '#8b98a5',
  away: '#d2a8ff',
};

export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)} %`;
export const money = (x: number) =>
  '$' + Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const signedMoney = (x: number) => (x >= 0 ? '+' : '−') + money(Math.abs(x));
export const fmtDate = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return x.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
};
