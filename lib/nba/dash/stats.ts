/** Props-page / legacy NBA stat codes (pts, fg3m, ...) → NBA dashboard chart keys. */
const NBA_DASH_STAT_ALIASES: Record<string, string> = {
  pts: 'points',
  point: 'points',
  points: 'points',
  reb: 'rebounds',
  rebs: 'rebounds',
  rebound: 'rebounds',
  rebounds: 'rebounds',
  ast: 'assists',
  assist: 'assists',
  assists: 'assists',
  fg3m: 'threeMade',
  '3pm': 'threeMade',
  threes: 'threeMade',
  threemade: 'threeMade',
  '3pointers': 'threeMade',
  fg3a: 'threeAttempted',
  threeattempted: 'threeAttempted',
  stl: 'steals',
  steals: 'steals',
  blk: 'blocks',
  blocks: 'blocks',
  to: 'turnovers',
  tov: 'turnovers',
  turnover: 'turnovers',
  turnovers: 'turnovers',
  min: 'minutes',
  minutes: 'minutes',
  fgm: 'fgMade',
  fga: 'fgAttempted',
  ftm: 'ftMade',
  fta: 'ftAttempted',
  oreb: 'offensiveRebounds',
  dreb: 'defensiveRebounds',
  pf: 'fouls',
  fouls: 'fouls',
  pra: 'pra',
  pr: 'pr',
  pa: 'pa',
  ra: 'ra',
  stocks: 'stocks',
  sb: 'stocks',
  potentialreb: 'potentialRebounds',
  potentialrebounds: 'potentialRebounds',
  reboundchances: 'potentialRebounds',
};

export function normalizeNbaDashStat(stat: string | null | undefined): string {
  const raw = String(stat || '').trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (!key) return 'points';
  return NBA_DASH_STAT_ALIASES[key] ?? raw;
}
