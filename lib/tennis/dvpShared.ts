export const TENNIS_DVP_MIN_MATCHES = 5;

export const TENNIS_DVP_WINDOWS = ['last5', 'last10', 'season'] as const;
export type TennisDvpWindow = (typeof TENNIS_DVP_WINDOWS)[number];

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

export type TennisDvpStage = 'main' | 'qualifying';
export type TennisDvpBestOf = 3 | 5;

function isSlamTournamentName(name: string | null | undefined): boolean {
  return /australian open|roland garros|french open|\bwimbledon\b|\bus open\b/.test(
    String(name || '').toLowerCase()
  );
}

/** Format of the live event. WTA and qualifying are always best of 3. */
export function tennisDvpTournamentBestOf(opts: {
  tour?: string | null;
  stage?: TennisDvpStage | string | null;
  tournamentName?: string | null;
  isGrandSlam?: boolean;
}): TennisDvpBestOf {
  if (String(opts.tour || '').toUpperCase() === 'WTA') return 3;
  if (opts.stage === 'qualifying' || isTennisQualifyingLabel(null, opts.tournamentName)) return 3;
  if (opts.isGrandSlam || isSlamTournamentName(opts.tournamentName)) return 5;
  return 3;
}

export function tennisDvpBestOfLabel(bestOf: TennisDvpBestOf | number | null | undefined): string {
  return Number(bestOf) === 5 ? 'Best of 5' : 'Best of 3';
}

export function isTennisQualifyingLabel(
  round?: string | null,
  tournamentName?: string | null
): boolean {
  return /qualif|\bq1\b|\bq2\b|\bq3\b|\bq-sf\b|\bq-f\b|\bqr\b|\bq-?final/.test(
    `${round || ''} ${tournamentName || ''}`.toLowerCase()
  );
}

export function tennisQualifyingEventLabel(name: string | null | undefined): string {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Qualifying';
  if (/qualif/i.test(raw)) return raw;
  return `${raw} Qualifying`;
}
