/**
 * Punter arm (admin-only test track): a bet is a stack of plain reasons about tonight, the way a
 * form analyst writes one up. It needs a matchup (the opponent is soft or tough where this player
 * gets his numbers, or against his position) and a catalyst (he is coming out of a run of the
 * opposite matchups, or a regular teammate is out and his numbers move without him), three such
 * reasons in all, with nothing of either kind pointing the other way. Overall defence, his record against the opponent and rest
 * are quoted in the write-up but never decide or rank a bet.
 *
 * Nothing here projects a number or a probability. The thresholds are fixed for the track version:
 * changing one means a new version, not an edit.
 */

import type { NblPropMarket } from '@/lib/aiPicks/markets';
import type { NbaPositionGroup } from '@/lib/aiPicks/model/nbaProps';

export const PUNTER_RULES = {
  /** Matchup and catalyst reasons a bet needs: a stack, not one soft opponent and one split. */
  minCore: 3,
  /** Teams this close to either end of the league count as soft (allow the most) or tough (the fewest). */
  band: 10,
  /** Teams that must be ranked before a rank means anything. */
  minTeamsRanked: 25,
  /** "His last five", and how many of them must be in the band for a run of matchups. */
  recentGames: 5,
  recentInBand: 3,
  /** Season games needed before his last five can be set against his season. */
  minSeasonGames: 8,
  /** A zone is his when it carries this share of his field-goal points, over at least this many makes. */
  zoneShare: 0.5,
  zoneMinMakes: 40,
  /** Games with and without a teammate, and how far his average must move. */
  splitMinGames: 5,
  splitMinShift: 0.1,
  /**
   * ...and the most his average without the teammate may clear the line by. A line set by books who
   * know the teammate is out, yet half as far again from that average, means those games are not the
   * player being priced tonight (a changed role, a minutes limit), so the split is not quoted.
   */
  splitMaxClear: 0.5,
  historyMaxGames: 6,
  historyMinGames: 3,
  historyMinRate: 0.75,
  /** Full days off that count as rested. */
  restedDaysOff: 2,
} as const;

export type PunterSide = 'over' | 'under';
export type PunterZoneGroup = 'paint' | 'mid' | 'three';
export type PunterAngleKey = 'schedule' | 'zone' | 'defence' | 'position' | 'teammate' | 'history' | 'rest';
export type PunterAngleKind = 'matchup' | 'catalyst' | 'support';

/** Rank 1 allows the least (toughest); `of` is how many teams were ranked. */
export type PunterRank = { rank: number; of: number; value: number };

export type PunterAngle = {
  key: PunterAngleKey;
  kind: PunterAngleKind;
  side: PunterSide;
  /** The fact in one sentence, numbers included; the write-up may only use these. */
  text: string;
  facts: Record<string, unknown>;
};

export type PunterGame = { matchId: string; date: string; season: number; opponent: string; value: number };

export type PunterTeammate = {
  name: string;
  status: string;
  /** Team games he played / missed since joining the team (match ids). */
  played: ReadonlySet<string>;
  missed: ReadonlySet<string>;
};

export type PunterZone = { group: PunterZoneGroup; share: number };

export type PunterInput = {
  stat: NblPropMarket;
  line: number;
  position: NbaPositionGroup | null;
  /** Opponent team code and display name. */
  opponent: string;
  opponentName: string;
  currentSeason: number;
  /** His games for his current team, this season and last, oldest first. */
  games: PunterGame[];
  /** Where his field-goal points come from; null when no zone carries half of them. */
  zone: PunterZone | null;
  /** Points a game each team allows from a zone. */
  zoneRanks: Partial<Record<PunterZoneGroup, ReadonlyMap<string, PunterRank>>>;
  /** This stat a game each team allows to his position. */
  positionRanks: ReadonlyMap<string, PunterRank> | null;
  /** Points allowed per 100 possessions. */
  defenceRanks: ReadonlyMap<string, PunterRank> | null;
  teammatesOut: PunterTeammate[];
  /** Days since the team's last game (1 = played yesterday). */
  restDays: number | null;
};

export type PunterCase = {
  side: PunterSide;
  stat: NblPropMarket;
  line: number;
  /** Reasons for the side, in write-up order. */
  angles: PunterAngle[];
  /** Matchup or catalyst reasons pointing the other way. */
  against: PunterAngle[];
  qualifies: boolean;
  /** Matchup and catalyst reasons for the side: what cases are ranked on first. */
  core: number;
  /**
   * How soft (over) or tough (under) the matchup is, 0 to 1: how far inside the band the opponent
   * sits, averaged over the matchup reasons. The league's softest is 1, the edge of the band 0.1.
   */
  matchup: number;
};

const SCORING: ReadonlySet<NblPropMarket> = new Set(['points', 'pra', 'pr', 'pa']);

const STAT_WORDS: Record<NblPropMarket, string> = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  threeMade: 'threes',
  pra: 'points + rebounds + assists',
  pr: 'points + rebounds',
  pa: 'points + assists',
  ra: 'rebounds + assists',
};

const ZONE_WORDS: Record<PunterZoneGroup, string> = { paint: 'in the paint', mid: 'from mid-range', three: 'from three' };
const POSITION_WORDS: Record<NbaPositionGroup, string> = { G: 'guards', F: 'forwards', C: 'centres' };
const WRITE_UP_ORDER: PunterAngleKey[] = ['schedule', 'zone', 'defence', 'position', 'teammate', 'history', 'rest'];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (v: number) => Math.round(v * 10) / 10;
const other = (side: PunterSide): PunterSide => (side === 'over' ? 'under' : 'over');

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

const ranked = (r: PunterRank | null | undefined): r is PunterRank => !!r && r.of >= PUNTER_RULES.minTeamsRanked;
/** Allows among the most in the league. */
export const isSoft = (r: PunterRank | null | undefined): boolean => ranked(r) && r.rank > r.of - PUNTER_RULES.band;
/** Allows among the fewest. */
export const isTough = (r: PunterRank | null | undefined): boolean => ranked(r) && r.rank <= PUNTER_RULES.band;

/** Places inside the band, as a share of it: the softest (over) or toughest (under) team is 1. */
function bandDepth(side: PunterSide, rank: number, of: number): number {
  const places = side === 'over' ? rank - (of - PUNTER_RULES.band) : PUNTER_RULES.band - rank + 1;
  return Math.min(1, Math.max(0, places / PUNTER_RULES.band));
}

/** A soft opponent backs the over, a tough one the under, the middle of the league neither. */
function sideOf(r: PunterRank | null | undefined): PunterSide | null {
  return isSoft(r) ? 'over' : isTough(r) ? 'under' : null;
}

/** "the 3rd most" / "the fewest": where the team sits from the end it is nearer. */
function allowPhrase(r: PunterRank): string {
  const fromTop = r.of - r.rank + 1;
  if (fromTop <= r.rank) return fromTop === 1 ? 'the most' : `the ${ordinal(fromTop)} most`;
  return r.rank === 1 ? 'the fewest' : `the ${ordinal(r.rank)} fewest`;
}

/** The zone this stat is judged on: threes always from three, scoring stats from his own zone. */
function zoneFor(i: PunterInput): PunterZoneGroup | null {
  if (i.stat === 'threeMade') return 'three';
  return SCORING.has(i.stat) ? (i.zone?.group ?? null) : null;
}

function zoneAngle(i: PunterInput): PunterAngle | null {
  const group = zoneFor(i);
  const r = group ? i.zoneRanks[group]?.get(i.opponent) : null;
  const side = sideOf(r);
  if (!group || !r || !side) return null;
  const allowed = i.stat === 'threeMade' ? `${round1(r.value / 3)} threes a game` : `${round1(r.value)} points a game ${ZONE_WORDS[group]}`;
  const share =
    i.stat !== 'threeMade' && i.zone ? ` ${Math.round(i.zone.share * 100)}% of his field-goal points come ${ZONE_WORDS[group]}.` : '';
  return {
    key: 'zone',
    kind: 'matchup',
    side,
    text: `${i.opponentName} allow ${allowPhrase(r)} in the league: ${allowed}.${share}`,
    facts: { zone: group, rank: r.rank, of: r.of, allowed: round1(r.value), share: i.zone?.share ?? null },
  };
}

function positionAngle(i: PunterInput): PunterAngle | null {
  const r = i.positionRanks?.get(i.opponent);
  const side = sideOf(r);
  if (!i.position || !r || !side) return null;
  return {
    key: 'position',
    kind: 'matchup',
    side,
    text: `${i.opponentName} allow ${allowPhrase(r)} ${STAT_WORDS[i.stat]} a game to ${POSITION_WORDS[i.position]} (${round1(r.value)}).`,
    facts: { position: i.position, rank: r.rank, of: r.of, allowed: round1(r.value) },
  };
}

function defenceAngle(i: PunterInput): PunterAngle | null {
  if (!SCORING.has(i.stat) && i.stat !== 'threeMade') return null;
  const r = i.defenceRanks?.get(i.opponent);
  const side = sideOf(r);
  if (!r || !side) return null;
  const fromWorst = r.of - r.rank + 1;
  const place =
    side === 'over'
      ? fromWorst === 1 ? 'the worst' : `the ${ordinal(fromWorst)} worst`
      : r.rank === 1 ? 'the best' : `the ${ordinal(r.rank)} best`;
  return {
    key: 'defence',
    kind: 'support',
    side,
    text: `${i.opponentName} have ${place} defensive rating in the league (${round1(r.value)} points allowed per 100 possessions).`,
    facts: { rank: r.rank, of: r.of, defRtg: round1(r.value) },
  };
}

/**
 * A run of matchups: most of his last five were at one end of the league for his matchup, his numbers
 * moved with it, and tonight is the other end. Tough run into a soft opponent is the bounce-back.
 */
function scheduleAngle(i: PunterInput): PunterAngle | null {
  const group = zoneFor(i);
  const ranks = group ? i.zoneRanks[group] : i.positionRanks;
  const tonight = ranks?.get(i.opponent);
  const season = i.games.filter((g) => g.season === i.currentSeason);
  if (!ranks || !tonight || season.length < PUNTER_RULES.minSeasonGames) return null;
  if (!group && !i.position) return null;
  const recent = season.slice(-PUNTER_RULES.recentGames);
  const recentAvg = mean(recent.map((g) => g.value));
  const seasonAvg = mean(season.map((g) => g.value));
  const where = group ? `defences ${ZONE_WORDS[group]}` : `defences for ${STAT_WORDS[i.stat]} against ${POSITION_WORDS[i.position!]}`;
  const run = (inBand: (r: PunterRank | undefined) => boolean) => recent.filter((g) => inBand(ranks.get(g.opponent)));
  const list = (games: PunterGame[]) => games.map((g) => `${g.opponent} ${ordinal(ranks.get(g.opponent)!.rank)}`).join(', ');
  const facts = (games: PunterGame[]) => ({
    measure: group ?? 'position',
    opponents: games.map((g) => ({ team: g.opponent, rank: ranks.get(g.opponent)!.rank })),
    recentAvg: round1(recentAvg),
    seasonAvg: round1(seasonAvg),
    tonightRank: tonight.rank,
    of: tonight.of,
  });

  const tough = run(isTough);
  if (tough.length >= PUNTER_RULES.recentInBand && isSoft(tonight) && recentAvg < seasonAvg) {
    return {
      key: 'schedule',
      kind: 'catalyst',
      side: 'over',
      text:
        `${tough.length} of his last ${recent.length} games were against top-${PUNTER_RULES.band} ${where} (${list(tough)}); ` +
        `he averaged ${round1(recentAvg)} ${STAT_WORDS[i.stat]} over those ${recent.length} against ${round1(seasonAvg)} for the season. ` +
        `Tonight's opponent ranks ${ordinal(tonight.rank)} of ${tonight.of}.`,
      facts: facts(tough),
    };
  }
  const soft = run(isSoft);
  if (soft.length >= PUNTER_RULES.recentInBand && isTough(tonight) && recentAvg > seasonAvg) {
    return {
      key: 'schedule',
      kind: 'catalyst',
      side: 'under',
      text:
        `${soft.length} of his last ${recent.length} games were against bottom-${PUNTER_RULES.band} ${where} (${list(soft)}); ` +
        `he averaged ${round1(recentAvg)} ${STAT_WORDS[i.stat]} over those ${recent.length} against ${round1(seasonAvg)} for the season. ` +
        `Tonight's opponent ranks ${ordinal(tonight.rank)} of ${tonight.of}.`,
      facts: facts(soft),
    };
  }
  return null;
}

type TeammateRead = { angle: PunterAngle; mate: PunterTeammate; shift: number };

/** His average with and without each absent teammate; the biggest move on each side that clears the line without leaving it far behind. */
function teammateReads(i: PunterInput): TeammateRead[] {
  const best = new Map<PunterSide, TeammateRead>();
  for (const mate of i.teammatesOut) {
    const withHim = i.games.filter((g) => mate.played.has(g.matchId)).map((g) => g.value);
    const without = i.games.filter((g) => mate.missed.has(g.matchId)).map((g) => g.value);
    if (withHim.length < PUNTER_RULES.splitMinGames || without.length < PUNTER_RULES.splitMinGames) continue;
    const a = mean(withHim);
    const b = mean(without);
    if (!(a > 0)) continue;
    const shift = b / a - 1;
    const side: PunterSide | null =
      shift >= PUNTER_RULES.splitMinShift && b > i.line ? 'over' : shift <= -PUNTER_RULES.splitMinShift && b < i.line ? 'under' : null;
    if (!side) continue;
    const clear = side === 'over' ? b / i.line - 1 : b > 0 ? i.line / b - 1 : Infinity;
    if (clear > PUNTER_RULES.splitMaxClear) continue;
    const prior = best.get(side);
    if (prior && Math.abs(prior.shift) >= Math.abs(shift)) continue;
    best.set(side, {
      mate,
      shift,
      angle: {
        key: 'teammate',
        kind: 'catalyst',
        side,
        text:
          `Teammate ${mate.name} is ${mate.status.toLowerCase()}. In ${without.length} games without ${mate.name} the player has averaged ` +
          `${round1(b)} ${STAT_WORDS[i.stat]}, against ${round1(a)} in ${withHim.length} games with him (this season and last, same team).`,
        facts: { teammate: mate.name, status: mate.status, without: round1(b), withoutGames: without.length, with: round1(a), withGames: withHim.length },
      },
    });
  }
  return [...best.values()];
}

/** His record on this line against tonight's opponent, without the absent teammate when there are enough such games. */
function historyAngle(i: PunterInput, side: PunterSide, mate: PunterTeammate | null): PunterAngle | null {
  const vs = i.games.filter((g) => g.opponent === i.opponent);
  const without = mate ? vs.filter((g) => mate.missed.has(g.matchId)) : [];
  const filtered = without.length >= PUNTER_RULES.historyMinGames;
  const games = (filtered ? without : vs).slice(-PUNTER_RULES.historyMaxGames);
  if (games.length < PUNTER_RULES.historyMinGames) return null;
  const hits = games.filter((g) => (side === 'over' ? g.value > i.line : g.value < i.line)).length;
  if (hits / games.length < PUNTER_RULES.historyMinRate) return null;
  const avg = round1(mean(games.map((g) => g.value)));
  return {
    key: 'history',
    kind: 'support',
    side,
    text:
      `Against ${i.opponentName}${filtered ? ` without ${mate!.name}` : ''} he has gone ${side} ${i.line} in ${hits} of his last ${games.length} ` +
      `(${avg} average).`,
    facts: { hits, games: games.length, average: avg, withoutTeammate: filtered ? mate!.name : null },
  };
}

function restAngle(i: PunterInput): PunterAngle | null {
  if (i.restDays == null) return null;
  const daysOff = i.restDays - 1;
  if (daysOff >= PUNTER_RULES.restedDaysOff) {
    return { key: 'rest', kind: 'support', side: 'over', text: `${daysOff} days off since the team's last game.`, facts: { daysOff } };
  }
  if (daysOff <= 0) {
    return { key: 'rest', kind: 'support', side: 'under', text: 'Second night of a back-to-back.', facts: { daysOff: 0 } };
  }
  return null;
}

/** Both sides of one player's line. A side qualifies on three reasons, a matchup and a catalyst among them, with neither kind against it. */
export function punterCases(i: PunterInput): Record<PunterSide, PunterCase> {
  const mates = teammateReads(i);
  const shared = [scheduleAngle(i), zoneAngle(i), defenceAngle(i), positionAngle(i), ...mates.map((m) => m.angle), restAngle(i)].filter(
    (a): a is PunterAngle => a != null
  );
  const build = (side: PunterSide): PunterCase => {
    const mate = mates.find((m) => m.angle.side === side)?.mate ?? null;
    const angles = [...shared.filter((a) => a.side === side), historyAngle(i, side, mate)]
      .filter((a): a is PunterAngle => a != null)
      .sort((a, b) => WRITE_UP_ORDER.indexOf(a.key) - WRITE_UP_ORDER.indexOf(b.key));
    const against = shared.filter((a) => a.side === other(side) && a.kind !== 'support');
    const has = (kind: PunterAngleKind) => angles.some((a) => a.kind === kind);
    const core = angles.filter((a) => a.kind !== 'support').length;
    const depths = angles.filter((a) => a.kind === 'matchup').map((a) => bandDepth(side, Number(a.facts.rank), Number(a.facts.of)));
    return {
      side,
      stat: i.stat,
      line: i.line,
      angles,
      against,
      qualifies: has('matchup') && has('catalyst') && core >= PUNTER_RULES.minCore && !against.length,
      core,
      matchup: depths.length ? Math.round(mean(depths) * 100) / 100 : 0,
    };
  };
  return { over: build('over'), under: build('under') };
}
