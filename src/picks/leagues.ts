/** Ligas que usa el Excel: código de football-data.co.uk → nombre para mostrar. */
export const MAIN_LEAGUES: Record<string, string> = {
  E0: 'Premier League (Inglaterra)', E1: 'Championship (Inglaterra)', SP1: 'LaLiga (España)', SP2: 'LaLiga 2 (España)',
  I1: 'Serie A (Italia)', I2: 'Serie B (Italia)', D1: 'Bundesliga (Alemania)', D2: '2. Bundesliga (Alemania)',
  F1: 'Ligue 1 (Francia)', F2: 'Ligue 2 (Francia)', N1: 'Eredivisie (Países Bajos)', P1: 'Primeira Liga (Portugal)',
  B1: 'Pro League (Bélgica)', G1: 'Super League (Grecia)', T1: 'Süper Lig (Turquía)', SC0: 'Premiership (Escocia)',
};

/** Ligas "nuevas" (un CSV con todas las temporadas): código → [país en el CSV, nombre para mostrar]. */
export const NEW_LEAGUES: Record<string, [string, string]> = {
  ARG: ['Argentina', 'Liga Profesional (Argentina)'], BRA: ['Brazil', 'Brasileirão (Brasil)'], MEX: ['Mexico', 'Liga MX (México)'],
  USA: ['USA', 'MLS (Estados Unidos)'], AUT: ['Austria', 'Bundesliga (Austria)'], DNK: ['Denmark', 'Superliga (Dinamarca)'],
  FIN: ['Finland', 'Veikkausliiga (Finlandia)'], IRL: ['Ireland', 'Premier Division (Irlanda)'], JPN: ['Japan', 'J1 League (Japón)'],
  NOR: ['Norway', 'Eliteserien (Noruega)'], POL: ['Poland', 'Ekstraklasa (Polonia)'], ROU: ['Romania', 'Liga I (Rumania)'],
  SWE: ['Sweden', 'Allsvenskan (Suecia)'], SWZ: ['Switzerland', 'Super League (Suiza)'], CHN: ['China', 'Superliga (China)'],
};

export function leagueName(code: string): string {
  return MAIN_LEAGUES[code] ?? NEW_LEAGUES[code]?.[1] ?? code;
}
