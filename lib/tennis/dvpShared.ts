export const TENNIS_DVP_MIN_MATCHES = 5;

/** AFL DVP-style allowed rows. `own` = this opponent’s own stat (serve leak). */
export const TENNIS_DVP_METRICS = [
  { key: 'totalGames', label: 'Avg Total Games', pct: false, source: 'allowed' },
  { key: 'gamesWon', label: 'Opp Games Allowed', pct: false, source: 'allowed' },
  { key: 'aces', label: 'Aces Allowed', pct: false, source: 'allowed' },
  { key: 'breakPointsConverted', label: 'Breaks Allowed', pct: false, source: 'allowed' },
  { key: 'returnPointsWonPct', label: 'Return Pts Allowed', pct: true, source: 'allowed' },
  { key: 'doubleFaults', label: 'DF Allowed', pct: false, source: 'own' },
  { key: 'firstServeWonPct', label: '1st Serve Won Allowed', pct: true, source: 'allowed' },
  { key: 'secondServeWonPct', label: '2nd Serve Won Allowed', pct: true, source: 'allowed' },
] as const;

export type TennisDvpMetricKey = (typeof TENNIS_DVP_METRICS)[number]['key'];
