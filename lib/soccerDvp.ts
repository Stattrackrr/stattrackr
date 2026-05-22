import {
  listSoccerCachedPlayerStatsPayloads,
  normalizeSoccerTeamHref,
  type SoccerCachedPlayerStatsPayloadRow,
} from '@/lib/soccerCache';
import {
  getCurrentSoccerSeasonYear,
  getSoccerSeasonYearFromKickoffUnix,
  type OpponentBreakdownLeagueFilter,
} from '@/lib/soccerOpponentBreakdown';
import { canonicalSoccerStatKey, readPlayerMatchStatNumber } from '@/lib/soccerStatKeyAliases';
import type { PlayerMatchStats } from '@/lib/soccerPlayerStatsScrape';

export type SoccerDvpTimeframe = 'season' | 'last5';

export type SoccerDvpRoleId = 'fullback' | 'cb' | 'midfield' | 'winger' | 'striker';

export type SoccerDvpMetricRow = {
  statKey: string;
  statLabel: string;
  label: string;
  perGame: number | null;
  rank: number | null;
  rankedSize: number;
  leagueAverage: number | null;
  gamesCounted: number;
  playerMatchCount: number;
};

export type SoccerDvpResult = {
  mode: 'league' | 'no-data';
  competitionLabel: string;
  timeframe: SoccerDvpTimeframe;
  opponentsSampled: number;
  opponents: string[];
  roles: Array<{ id: SoccerDvpRoleId; label: string }>;
  opponent: {
    name: string;
    href: string | null;
    rowsByRole: Record<SoccerDvpRoleId, SoccerDvpMetricRow[]>;
  } | null;
  note?: string;
};

export type SoccerDvpApiResponse = SoccerDvpResult;

export type SoccerDvpLeagueMatrixResult = {
  mode: 'league' | 'no-data';
  competitionLabel: string;
  timeframe: SoccerDvpTimeframe;
  opponentsSampled: number;
  opponents: string[];
  roles: Array<{ id: SoccerDvpRoleId; label: string }>;
  opponentRows: Array<{
    name: string;
    href: string | null;
    rowsByRole: Record<SoccerDvpRoleId, SoccerDvpMetricRow[]>;
  }>;
  note?: string;
};

type RoleDef = {
  id: SoccerDvpRoleId;
  label: string;
  codes: string[];
  rawTokens: string[];
};

type RoleAccumulator = {
  stats: Map<string, StatAccumulator>;
};

type StatAccumulator = {
  total: number;
  playerMatchCount: number;
  matchIds: Set<string>;
};

type OpponentAccumulator = {
  name: string;
  href: string | null;
  roles: Map<SoccerDvpRoleId, RoleAccumulator>;
};

type PlayerPayloadRow = SoccerCachedPlayerStatsPayloadRow<PlayerMatchStats>;

const ROLE_DEFS: RoleDef[] = [
  {
    id: 'fullback',
    label: 'Fullback',
    codes: ['FB', 'WB', 'LB', 'RB', 'LWB', 'RWB'],
    rawTokens: ['fullback', 'full back', 'wingback', 'wing back', 'left back', 'right back', 'left wingback', 'right wingback'],
  },
  {
    id: 'cb',
    label: 'CB',
    codes: ['CB', 'DEF', 'D'],
    rawTokens: ['centre back', 'center back', 'defender'],
  },
  {
    id: 'midfield',
    label: 'Midfield',
    codes: ['CM', 'CDM', 'DM', 'CAM', 'AM', 'MID', 'M'],
    rawTokens: ['central midfielder', 'midfielder', 'attacking midfielder', 'defensive midfielder'],
  },
  {
    id: 'winger',
    label: 'Winger',
    codes: ['W', 'LW', 'RW'],
    rawTokens: ['winger', 'wing', 'left winger', 'right winger', 'left wing', 'right wing', 'wide midfielder'],
  },
  {
    id: 'striker',
    label: 'Striker',
    codes: ['ST', 'CF', 'FW', 'FWD'],
    rawTokens: ['striker', 'forward', 'centre forward', 'center forward'],
  },
];

const DVP_STAT_DEFS = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'total_shots', label: 'Shots' },
  { key: 'shots_on_target', label: 'Shots on Target' },
  { key: 'fouls_committed', label: 'Fouls Committed' },
  { key: 'fouls_suffered', label: 'Fouls Suffered' },
  { key: 'yellow_cards', label: 'Yellow Cards' },
  { key: 'red_cards', label: 'Red Cards' },
].map((stat) => ({ ...stat, key: canonicalSoccerStatKey(stat.key) }));

const ROLE_BY_ID = new Map(ROLE_DEFS.map((role) => [role.id, role] as const));
const ROLE_ORDER = ROLE_DEFS.map((role) => role.id);

function normalizeToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOpponentName(value: string | null | undefined): string {
  let text = normalizeToken(value).replace(/\b(fc|afc|cf)\b/g, '').replace(/\s+/g, ' ').trim();
  const aliases: Array<[RegExp, string]> = [
    [/\bmanchester united\b|\bman utd\b|\bman united\b/, 'manchester united'],
    [/\bmanchester city\b|\bman city\b/, 'manchester city'],
    [/\bbrighton hove albion\b|\bbrighton\b/, 'brighton'],
    [/\bafc bournemouth\b|\bbournemouth\b/, 'bournemouth'],
    [/\bwolverhampton wanderers\b|\bwolves\b|\bwolverhampton\b/, 'wolves'],
    [/\bnottingham forest\b|\bnottingham\b/, 'nottingham'],
    [/\bnewcastle united\b|\bnewcastle\b/, 'newcastle'],
    [/\bwest ham united\b|\bwest ham\b/, 'west ham'],
    [/\btottenham hotspur\b|\btottenham\b|\bspurs\b/, 'tottenham'],
    [/\bleeds united\b|\bleeds\b/, 'leeds'],
    [/\bcrystal palace\b|\bpalace\b/, 'crystal palace'],
    [/\bsunderland\b/, 'sunderland'],
    [/\bliverpool\b/, 'liverpool'],
    [/\beverton\b/, 'everton'],
  ];
  for (const [pattern, canonical] of aliases) {
    if (pattern.test(text)) {
      text = canonical;
      break;
    }
  }
  return text;
}

function normalizeCompetitionToken(value: string | null | undefined): string {
  return normalizeToken(value).replace(/\b(the|cup|league)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function valuesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeOpponentName(a);
  const right = normalizeOpponentName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function competitionLabel(filter: OpponentBreakdownLeagueFilter): string {
  const country = String(filter.competitionCountry || '').trim();
  const name = String(filter.competitionName || '').trim();
  return [country, name].filter(Boolean).join(' · ') || name || country || 'League';
}

function roleFromCodeOrRaw(codeRaw: string | null | undefined, rawRole: string | null | undefined): SoccerDvpRoleId | null {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (code) {
    const found = ROLE_DEFS.find((role) => role.codes.includes(code));
    if (found) return found.id;
  }

  const raw = normalizeToken(rawRole);
  if (!raw) return null;

  // Specific midfield roles must win before generic "midfielder".
  for (const roleId of ['fullback', 'cb', 'midfield', 'winger', 'striker'] as SoccerDvpRoleId[]) {
    const role = ROLE_BY_ID.get(roleId);
    if (role?.rawTokens.some((token) => raw.includes(normalizeToken(token)))) return role.id;
  }

  return null;
}

function roleForMatch(row: PlayerPayloadRow, match: PlayerMatchStats): SoccerDvpRoleId | null {
  return (
    roleFromCodeOrRaw(match.position, match.positionRaw) ??
    roleFromCodeOrRaw(row.payload.primaryPosition ?? row.position, row.payload.primaryPositionRaw)
  );
}

function matchIdKey(match: PlayerMatchStats): string {
  return String(match.matchId || match.summaryPath || `${match.opponent}:${match.kickoffUnix ?? ''}`).trim();
}

function competitionTokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeCompetitionToken(a);
  const right = normalizeCompetitionToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function playerMatchBelongsToCompetition(match: PlayerMatchStats, filter: OpponentBreakdownLeagueFilter): boolean {
  if (!competitionTokensMatch(match.competitionName, filter.competitionName)) return false;
  const filterCountry = normalizeCompetitionToken(filter.competitionCountry);
  const matchCountry = normalizeCompetitionToken(match.competitionCountry);
  if (filterCountry && matchCountry) return filterCountry === matchCountry;
  return true;
}

function filterMatchesForDvp(
  matches: PlayerMatchStats[],
  filter: OpponentBreakdownLeagueFilter,
  seasonYear: number
): PlayerMatchStats[] {
  if (!Number.isFinite(seasonYear) || seasonYear <= 0) return [];
  return matches.filter(
    (match) =>
      getSoccerSeasonYearFromKickoffUnix(match.kickoffUnix) === seasonYear &&
      playerMatchBelongsToCompetition(match, filter)
  );
}

function uniqueRecentMatchIds(rows: Array<{ match: PlayerMatchStats }>, limit: number): Set<string> {
  const byId = new Map<string, PlayerMatchStats>();
  for (const { match } of rows) {
    const key = matchIdKey(match);
    if (!key || byId.has(key)) continue;
    byId.set(key, match);
  }
  return new Set(
    [...byId.entries()]
      .sort((a, b) => {
        const kickoffDelta = (b[1].kickoffUnix ?? 0) - (a[1].kickoffUnix ?? 0);
        if (kickoffDelta !== 0) return kickoffDelta;
        return b[0].localeCompare(a[0]);
      })
      .slice(0, limit)
      .map(([id]) => id)
  );
}

function getRoleAccumulator(opponent: OpponentAccumulator, role: SoccerDvpRoleId): RoleAccumulator {
  const existing = opponent.roles.get(role);
  if (existing) return existing;
  const next = { stats: new Map<string, StatAccumulator>() };
  opponent.roles.set(role, next);
  return next;
}

function getStatAccumulator(opponent: OpponentAccumulator, role: SoccerDvpRoleId, statKey: string): StatAccumulator {
  const roleAcc = getRoleAccumulator(opponent, role);
  const existing = roleAcc.stats.get(statKey);
  if (existing) return existing;
  const next = { total: 0, playerMatchCount: 0, matchIds: new Set<string>() };
  roleAcc.stats.set(statKey, next);
  return next;
}

function emptyMetricRow(
  statKey: string,
  statLabel: string,
  rankedSize = 0,
  leagueAverage: number | null = null
): SoccerDvpMetricRow {
  return {
    statKey,
    statLabel,
    label: statLabel,
    perGame: null,
    rank: null,
    rankedSize,
    leagueAverage,
    gamesCounted: 0,
    playerMatchCount: 0,
  };
}

function buildRowsByRoleForOpponent(
  opponent: OpponentAccumulator | null,
  allOpponents: OpponentAccumulator[]
): Record<SoccerDvpRoleId, SoccerDvpMetricRow[]> {
  return Object.fromEntries(
    ROLE_ORDER.map((roleId) => [
      roleId,
      DVP_STAT_DEFS.map((stat) => {
        const roleValues = allOpponents
          .map((candidate) => {
            const acc = candidate.roles.get(roleId)?.stats.get(stat.key);
            if (!acc || acc.matchIds.size === 0) return null;
            return {
              key: normalizeOpponentName(candidate.name),
              value: acc.total / acc.matchIds.size,
            };
          })
          .filter((row): row is { key: string; value: number } => Boolean(row && Number.isFinite(row.value)));

        const ranked = [...roleValues].sort((a, b) => b.value - a.value);
        const rankByOpponent = new Map<string, number>();
        let rank = 1;
        for (let i = 0; i < ranked.length; i += 1) {
          if (i > 0 && ranked[i].value !== ranked[i - 1].value) rank = i + 1;
          rankByOpponent.set(ranked[i].key, rank);
        }

        const leagueAverage =
          roleValues.length > 0 ? roleValues.reduce((sum, row) => sum + row.value, 0) / roleValues.length : null;
        const acc = opponent?.roles.get(roleId)?.stats.get(stat.key);
        if (!opponent || !acc || acc.matchIds.size === 0) {
          return emptyMetricRow(stat.key, stat.label, roleValues.length, leagueAverage);
        }

        return {
          statKey: stat.key,
          statLabel: stat.label,
          label: stat.label,
          perGame: acc.total / acc.matchIds.size,
          rank: rankByOpponent.get(normalizeOpponentName(opponent.name)) ?? null,
          rankedSize: roleValues.length,
          leagueAverage,
          gamesCounted: acc.matchIds.size,
          playerMatchCount: acc.playerMatchCount,
        };
      }),
    ])
  ) as Record<SoccerDvpRoleId, SoccerDvpMetricRow[]>;
}

async function buildSoccerDvpOpponentAccumulators(options: {
  competitionName: string;
  competitionCountry?: string | null;
  timeframe: SoccerDvpTimeframe;
  seasonYear?: number;
}): Promise<{
  filter: OpponentBreakdownLeagueFilter;
  allOpponents: OpponentAccumulator[];
  opponentNames: string[];
  roles: Array<{ id: SoccerDvpRoleId; label: string }>;
}> {
  const filter: OpponentBreakdownLeagueFilter = {
    competitionName: options.competitionName,
    competitionCountry: options.competitionCountry || null,
  };
  const seasonYear = options.seasonYear ?? getCurrentSoccerSeasonYear();
  const payloads = await listSoccerCachedPlayerStatsPayloads({ quiet: true });
  const rowsByOpponent = new Map<string, Array<{ row: PlayerPayloadRow; match: PlayerMatchStats }>>();

  for (const row of payloads) {
    const matches = filterMatchesForDvp(row.payload.matches ?? [], filter, seasonYear);
    for (const match of matches) {
      const opponentKey = normalizeOpponentName(match.opponent);
      if (!opponentKey) continue;
      const list = rowsByOpponent.get(opponentKey);
      if (list) list.push({ row, match });
      else rowsByOpponent.set(opponentKey, [{ row, match }]);
    }
  }

  const opponents = new Map<string, OpponentAccumulator>();
  for (const [opponentKey, rows] of rowsByOpponent.entries()) {
    const includeMatchIds = options.timeframe === 'last5' ? uniqueRecentMatchIds(rows, 5) : null;

    for (const { row, match } of rows) {
      if (includeMatchIds && !includeMatchIds.has(matchIdKey(match))) continue;
      const role = roleForMatch(row, match);
      if (!role) continue;

      const opponent =
        opponents.get(opponentKey) ??
        {
          name: match.opponent,
          href: null,
          roles: new Map<SoccerDvpRoleId, RoleAccumulator>(),
        };
      opponents.set(opponentKey, opponent);

      for (const stat of DVP_STAT_DEFS) {
        const value = readPlayerMatchStatNumber(match.categories, stat.key);
        if (value == null) continue;
        const acc = getStatAccumulator(opponent, role, stat.key);
        acc.total += value;
        acc.playerMatchCount += 1;
        acc.matchIds.add(matchIdKey(match));
      }
    }
  }

  const allOpponents = [...opponents.values()];
  return {
    filter,
    allOpponents,
    opponentNames: allOpponents.map((row) => row.name).sort((a, b) => a.localeCompare(b)),
    roles: ROLE_DEFS.map((role) => ({ id: role.id, label: role.label })),
  };
}

export async function buildSoccerLeagueDvpMatrix(options: {
  competitionName: string;
  competitionCountry?: string | null;
  timeframe: SoccerDvpTimeframe;
  seasonYear?: number;
}): Promise<SoccerDvpLeagueMatrixResult> {
  const { filter, allOpponents, opponentNames, roles } = await buildSoccerDvpOpponentAccumulators(options);
  const note =
    options.timeframe === 'last5'
      ? 'Using each opponent’s latest 5 current-season matches from cached player stats.'
      : 'Using current-season cached player stats.';

  return {
    mode: allOpponents.length ? 'league' : 'no-data',
    competitionLabel: competitionLabel(filter),
    timeframe: options.timeframe,
    opponentsSampled: allOpponents.length,
    opponents: opponentNames,
    roles,
    opponentRows: allOpponents
      .map((opponent) => ({
        name: opponent.name,
        href: null,
        rowsByRole: buildRowsByRoleForOpponent(opponent, allOpponents),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    note: allOpponents.length ? note : 'No cached player DVP data is available yet.',
  };
}

export async function buildSoccerRoleDvp(options: {
  opponentName: string;
  opponentHref?: string | null;
  competitionName: string;
  competitionCountry?: string | null;
  timeframe: SoccerDvpTimeframe;
  seasonYear?: number;
}): Promise<SoccerDvpResult> {
  const { filter, allOpponents, opponentNames, roles } = await buildSoccerDvpOpponentAccumulators(options);
  const selectedOpponentKey = normalizeOpponentName(options.opponentName);
  const selectedKey =
    opponentNames.find((key) => normalizeOpponentName(key) === selectedOpponentKey || valuesMatch(key, selectedOpponentKey)) ??
    selectedOpponentKey;
  const opponent =
    allOpponents.find((candidate) => normalizeOpponentName(candidate.name) === normalizeOpponentName(selectedKey)) ??
    allOpponents.find((candidate) => valuesMatch(candidate.name, options.opponentName)) ??
    null;

  if (!allOpponents.length || !opponent) {
    return {
      mode: 'no-data',
      competitionLabel: competitionLabel(filter),
      timeframe: options.timeframe,
      opponentsSampled: allOpponents.length,
      opponents: opponentNames,
      roles,
      opponent: null,
      note: 'No cached player DVP data is available for this opponent yet.',
    };
  }

  return {
    mode: 'league',
    competitionLabel: competitionLabel(filter),
    timeframe: options.timeframe,
    opponentsSampled: allOpponents.length,
    opponents: opponentNames,
    roles,
    opponent: {
      name: opponent.name || options.opponentName,
      href: normalizeSoccerTeamHref(options.opponentHref || '') || null,
      rowsByRole: buildRowsByRoleForOpponent(opponent, allOpponents),
    },
    note:
      options.timeframe === 'last5'
        ? 'Using each opponent’s latest 5 current-season matches from cached player stats.'
        : 'Using current-season cached player stats.',
  };
}
