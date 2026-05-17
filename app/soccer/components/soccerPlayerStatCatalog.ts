import type { PlayerMatchStats, PlayerStatCategory } from '@/lib/soccerPlayerStatsScrape';
import {
  canonicalSoccerStatKey,
  parseSoccerPlayerStatNumber,
  readPlayerMatchStatNumber,
} from '@/lib/soccerStatKeyAliases';

export type SoccerPlayerStatDef = {
  key: string;
  label: string;
};

/** Outfield player — main chart pill order (only these appear on the top chart). */
export const OUTFIELD_MAIN_CHART_STATS: SoccerPlayerStatDef[] = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'total_shots', label: 'Total Shots' },
  { key: 'shots_on_target', label: 'Shots on Target' },
  { key: 'shots_outside_the_box', label: 'Shots Outside the Box' },
  // Soccerway may add this key later; hidden until present in cache.
  { key: 'shots_on_target_outside_the_box', label: 'SOT Outside the Box' },
  { key: 'accurate_passes', label: 'Passes' },
  { key: 'big_chances_created', label: 'Big Chances Created' },
  { key: 'fouls_committed', label: 'Fouls Committed' },
  { key: 'fouls_suffered', label: 'Fouls Suffered' },
  { key: 'duels_won', label: 'Duels Won' },
  { key: 'yellow_cards', label: 'Yellow Cards' },
  { key: 'red_cards', label: 'Red Cards' },
];

export const OUTFIELD_MAIN_CHART_KEYS = new Set(
  OUTFIELD_MAIN_CHART_STATS.map((stat) => canonicalSoccerStatKey(stat.key))
);

/** Main-chart shot stats that share the same supporting panel as Goals. */
const SHOT_MAIN_CHART_SUPPORTING_MAIN_KEYS = new Set(
  ['goals', 'total_shots', 'shots_on_target', 'shots_outside_the_box'].map((key) => canonicalSoccerStatKey(key))
);

/** Shot-family supporting stats (plus mins) for Goals / Total Shots / SOT / Shots Outside the Box. */
const GOALS_SUPPORTING_PREF_ORDER = [
  'total_shots',
  'shots_on_target',
  'shots_inside_the_box',
  'shots_on_target_inside_the_box',
  'shots_off_target',
  'blocked_shots',
  'headed_shots',
  'touches_in_opposition_box',
  'big_chances_missed',
];

/** When main chart = Assists: chance-creation / passing supporting stats (plus mins). */
const ASSISTS_SUPPORTING_PREF_ORDER = [
  'expected_assists_xa',
  'key_passes',
  'accurate_crosses',
  'accurate_long_passes',
  'accurate_passes_in_final_third',
];

/** When main chart = Passes: build-up / distribution supporting stats (plus mins). */
const PASSES_MAIN_CHART_SUPPORTING_PREF_ORDER = [
  'touches',
  'expected_assists_xa',
  'key_passes',
  'accurate_passes_in_final_third',
  'accurate_long_passes',
  'accurate_crosses',
  'interceptions',
];

/** When main chart = Fouls Committed: defensive duel supporting stats (plus mins). */
const FOULS_COMMITTED_SUPPORTING_PREF_ORDER = [
  'tackles_won',
  'duels_won',
  'aerial_duels_won',
  'ground_duels_won',
  'yellow_cards',
  'red_cards',
];

/** When main chart = Fouls Suffered: contact / involvement supporting stats (plus mins). */
const FOULS_SUFFERED_SUPPORTING_PREF_ORDER = ['duels', 'touches', 'tackles_won', 'accurate_passes'];

/** When main chart = Duels Won: discipline / tackle supporting stats (plus mins). */
const DUELS_WON_SUPPORTING_PREF_ORDER = ['fouls_committed', 'tackles_won', 'yellow_cards'];

/** When main chart = Yellow / Red Cards: shared discipline supporting stats (plus mins). */
const CARD_DISCIPLINE_SUPPORTING_PREF_ORDER = [
  'fouls_committed',
  'tackles_won',
  'duels_won',
  'aerial_duels_won',
  'ground_duels_won',
  'yellow_cards',
  'red_cards',
];

const CARD_DISCIPLINE_MAIN_CHART_KEYS = new Set(
  ['yellow_cards', 'red_cards'].map((key) => canonicalSoccerStatKey(key))
);

function isPlayerShotFamilyStatKey(canon: string): boolean {
  if (canon.startsWith('errors_leading_to_')) return false;
  return canon.includes('shot');
}

type SupportingKeyAdder = (rawKey: string) => void;

function appendGoalsStyleSupportingStats(addKey: SupportingKeyAdder, available: Set<string>) {
  for (const key of GOALS_SUPPORTING_PREF_ORDER) {
    addKey(key);
  }
  for (const key of [...available].sort((a, b) => getSoccerPlayerStatLabel(a).localeCompare(getSoccerPlayerStatLabel(b)))) {
    if (!isPlayerShotFamilyStatKey(key)) continue;
    addKey(key);
  }
}

function appendPassesStyleSupportingStats(addKey: SupportingKeyAdder) {
  for (const key of PASSES_MAIN_CHART_SUPPORTING_PREF_ORDER) {
    addKey(key);
  }
}

const STAT_CATEGORY_ORDER: PlayerStatCategory[] = [
  'top',
  'shots',
  'attack',
  'passes',
  'defense',
  'goalkeeping',
  'general',
];

/** Supporting stats order — mins first, then the rest of the Soccerway player stat universe. */
export const SUPPORTING_STAT_ORDER: SoccerPlayerStatDef[] = [
  { key: 'minutes_played', label: 'Mins' },
  { key: 'expected_goals_xg', label: 'xG' },
  { key: 'expected_assists_xa', label: 'xA' },
  { key: 'xg_on_target_xgot', label: 'xGOT' },
  { key: 'rating', label: 'Rating' },
  { key: 'touches', label: 'Touches' },
  { key: 'touches_in_opposition_box', label: 'Touches in Opp. Box' },
  { key: 'successful_dribbles', label: 'Successful Dribbles' },
  { key: 'shots_inside_the_box', label: 'Shots Inside the Box' },
  { key: 'shots_off_target', label: 'Shots off Target' },
  { key: 'blocked_shots', label: 'Blocked Shots' },
  { key: 'headed_shots', label: 'Headed Shots' },
  { key: 'key_passes', label: 'Key Passes' },
  { key: 'accurate_crosses', label: 'Accurate Crosses' },
  { key: 'accurate_long_passes', label: 'Accurate Long Passes' },
  { key: 'accurate_passes_in_final_third', label: 'Passes in Final Third' },
  { key: 'big_chances_missed', label: 'Big Chances Missed' },
  { key: 'offsides', label: 'Offsides' },
  { key: 'tackles_won', label: 'Tackles Won' },
  { key: 'interceptions', label: 'Interceptions' },
  { key: 'clearances', label: 'Clearances' },
  { key: 'aerials_won', label: 'Aerial Duels Won' },
  { key: 'ground_duels_won', label: 'Ground Duels Won' },
  { key: 'errors_leading_to_shot', label: 'Errors Leading to Shot' },
  { key: 'errors_leading_to_goal', label: 'Errors Leading to Goal' },
  { key: 'own_goals', label: 'Own Goals' },
  { key: 'goalkeeper_saves', label: 'GK Saves' },
  { key: 'goals_conceded', label: 'Goals Conceded' },
  { key: 'goals_prevented', label: 'Goals Prevented' },
  { key: 'xgot_faced', label: 'xGOT Faced' },
  { key: 'punches', label: 'Punches' },
  { key: 'throws', label: 'Throws' },
  { key: 'act_as_sweeper', label: 'Act as Sweeper' },
];

const LABEL_BY_KEY = new Map<string, string>(
  [
    ...OUTFIELD_MAIN_CHART_STATS,
    ...SUPPORTING_STAT_ORDER,
    { key: 'shots_inside_the_box', label: 'Shots Inside the Box' },
    { key: 'shots_on_target_inside_the_box', label: 'SOT Inside the Box' },
  ].map((stat) => [canonicalSoccerStatKey(stat.key), stat.label])
);

export function getSoccerPlayerStatLabel(key: string): string {
  const canon = canonicalSoccerStatKey(key);
  const fromCatalog = LABEL_BY_KEY.get(canon);
  if (fromCatalog) return fromCatalog;
  return canon
    .split('_')
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

export function playerHasStat(matches: PlayerMatchStats[], canonicalKey: string): boolean {
  const target = canonicalSoccerStatKey(canonicalKey);
  return matches.some((match) => readPlayerMatchStatNumber(match.categories, target) != null);
}

export function bestCategoryForCanonicalStat(
  matches: PlayerMatchStats[],
  canonicalKey: string
): PlayerStatCategory {
  const target = canonicalSoccerStatKey(canonicalKey);
  let best: PlayerStatCategory = 'top';
  let bestScore = -1;
  for (const category of STAT_CATEGORY_ORDER) {
    let score = 0;
    for (const match of matches) {
      if (readPlayerMatchStatNumber(match.categories, target) != null) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

export function collectAvailablePlayerStatKeys(matches: PlayerMatchStats[]): Set<string> {
  const keys = new Set<string>();
  for (const match of matches) {
    for (const category of STAT_CATEGORY_ORDER) {
      const stats = match.categories[category]?.stats;
      if (!stats) continue;
      for (const [rawKey, raw] of Object.entries(stats)) {
        if (parseSoccerPlayerStatNumber(raw) == null) continue;
        keys.add(canonicalSoccerStatKey(rawKey));
      }
    }
  }
  return keys;
}

export type MainChartStatTile = {
  id: string;
  label: string;
  category: PlayerStatCategory;
  key: string;
};

export function buildOutfieldMainChartTiles(matches: PlayerMatchStats[]): MainChartStatTile[] {
  return OUTFIELD_MAIN_CHART_STATS.filter((stat) => playerHasStat(matches, stat.key)).map((stat) => {
    const canon = canonicalSoccerStatKey(stat.key);
    const category = bestCategoryForCanonicalStat(matches, canon);
    return {
      id: `${category}:${canon}`,
      label: stat.label,
      category,
      key: canon,
    };
  });
}

export function buildSupportingStatKeys(
  matches: PlayerMatchStats[],
  mainStatKey: string
): string[] {
  const mainCanon = canonicalSoccerStatKey(mainStatKey);
  const available = collectAvailablePlayerStatKeys(matches);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const addKey = (rawKey: string) => {
    const canon = canonicalSoccerStatKey(rawKey);
    if (canon === mainCanon) return;
    if (!available.has(canon)) return;
    if (seen.has(canon)) return;
    seen.add(canon);
    ordered.push(canon);
  };

  addKey('minutes_played');

  if (SHOT_MAIN_CHART_SUPPORTING_MAIN_KEYS.has(mainCanon)) {
    appendGoalsStyleSupportingStats(addKey, available);
    return ordered;
  }

  if (mainCanon === 'big_chances_created') {
    appendGoalsStyleSupportingStats(addKey, available);
    appendPassesStyleSupportingStats(addKey);
    return ordered;
  }

  if (mainCanon === 'assists') {
    for (const key of ASSISTS_SUPPORTING_PREF_ORDER) {
      addKey(key);
    }
    return ordered;
  }

  if (mainCanon === 'accurate_passes') {
    for (const key of PASSES_MAIN_CHART_SUPPORTING_PREF_ORDER) {
      addKey(key);
    }
    return ordered;
  }

  if (mainCanon === 'fouls_committed') {
    for (const key of FOULS_COMMITTED_SUPPORTING_PREF_ORDER) {
      addKey(key);
    }
    return ordered;
  }

  if (mainCanon === 'fouls_suffered') {
    for (const key of FOULS_SUFFERED_SUPPORTING_PREF_ORDER) {
      addKey(key);
    }
    return ordered;
  }

  if (mainCanon === 'duels_won') {
    for (const key of DUELS_WON_SUPPORTING_PREF_ORDER) {
      addKey(key);
    }
    return ordered;
  }

  if (CARD_DISCIPLINE_MAIN_CHART_KEYS.has(mainCanon)) {
    for (const key of CARD_DISCIPLINE_SUPPORTING_PREF_ORDER) {
      addKey(key);
    }
    return ordered;
  }

  for (const stat of SUPPORTING_STAT_ORDER) {
    addKey(stat.key);
  }

  const leftovers = [...available]
    .filter((key) => !seen.has(key))
    .sort((a, b) => getSoccerPlayerStatLabel(a).localeCompare(getSoccerPlayerStatLabel(b)));

  for (const key of leftovers) {
    addKey(key);
  }

  return ordered;
}
