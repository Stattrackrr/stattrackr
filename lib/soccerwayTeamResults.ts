/**
 * Parse match results embedded in Soccerway team /results/ HTML (Flashscore-style ~AA÷ blocks).
 * Returns every valid match found in the document (no cap unless `limit` is passed).
 *
 * Note: the first HTML response only contains the feeds Soccerway inlined (e.g. cjs.initialFeeds).
 * The site loads deeper history after "Show more" via their client; that text is not in this HTML.
 */

export type SoccerwayRecentMatch = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeLogoUrl?: string | null;
  awayLogoUrl?: string | null;
  competitionName?: string | null;
  competitionCountry?: string | null;
  homeScore: number;
  awayScore: number;
  kickoffUnix: number | null;
  summaryPath: string;
  stats?: SoccerwayMatchStats | null;
};

export type SoccerwayUpcomingFixture = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUnix: number | null;
  summaryPath: string;
  competitionName: string | null;
  competitionCountry: string | null;
  competitionStage: string | null;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
};

export type SoccerwayMatchStat = {
  id: string | null;
  name: string;
  homeValue: string | null;
  awayValue: string | null;
  fields: Record<string, string>;
};

export type SoccerwayMatchStatsCategory = {
  name: string;
  stats: SoccerwayMatchStat[];
};

export type SoccerwayMatchStatsPeriod = {
  name: string;
  categories: SoccerwayMatchStatsCategory[];
};

export type SoccerwayMatchStats = {
  feedUrl: string;
  periods: SoccerwayMatchStatsPeriod[];
  raw: string;
};

export type SoccerwayLineupSide = 'home' | 'away';

export type SoccerwayLineupPlayer = {
  id: string;
  participantId: string | null;
  side: SoccerwayLineupSide;
  fieldName: string;
  listName: string;
  number: string | null;
  participantUrl: string | null;
  imageUrl: string | null;
  roleTitles: string[];
  roleSuffixes: string[];
};

export type SoccerwayLineupFormationRow = {
  sortKey: number;
  players: SoccerwayLineupPlayer[];
};

export type SoccerwayLineupFormationLine = {
  sortKey: number;
  name: string;
  rows: SoccerwayLineupFormationRow[];
};

export type SoccerwayLineupTeam = {
  side: SoccerwayLineupSide;
  participantId: string | null;
  name: string;
  formationName: string | null;
  starters: SoccerwayLineupPlayer[];
  substitutes: SoccerwayLineupPlayer[];
  coaches: SoccerwayLineupPlayer[];
  formationLines: SoccerwayLineupFormationLine[];
};

export type SoccerwayLineupStatus = 'predicted' | 'official' | 'unavailable';

export type SoccerwayLineupBundle = {
  status: SoccerwayLineupStatus;
  eventId: string | null;
  teams: SoccerwayLineupTeam[];
};

export type SoccerwaySquadAbsence = {
  player: string;
  status: 'injury' | 'suspension' | 'absence';
  reason: string;
  estimatedReturn: string | null;
  playerUrl: string | null;
};

export type SoccerwayPlayerInjuryHistoryRow = {
  from: string;
  until: string;
  injury: string;
};

/** True when the bundle has at least one team with starters, formation, subs, or coaches (same filter as the pitch UI). */
export function hasDisplayableSoccerLineup(lineup: SoccerwayLineupBundle | null | undefined): boolean {
  if (!lineup || !Array.isArray(lineup.teams)) return false;
  return lineup.teams.some(
    (team) =>
      team.starters.length > 0 ||
      team.formationLines.length > 0 ||
      team.substitutes.length > 0 ||
      team.coaches.length > 0
  );
}

function buildSoccerwayResultDedupeKey(match: { matchId?: string | null; summaryPath?: string | null }): string {
  const matchId = String(match.matchId || '').trim();
  if (matchId) return `match:${matchId}`;
  return `summary:${String(match.summaryPath || '').trim()}`;
}

function pickInt(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function pickUnix(raw: string | undefined): number | null {
  const n = pickInt(raw);
  return n != null && n > 1_000_000_000 ? n : null;
}

type SoccerwayFeedSegment =
  | { type: 'match'; body: string }
  | { type: 'competition'; body: string };

function splitSoccerwayFeedSegments(raw: string): SoccerwayFeedSegment[] {
  return raw
    .split('~')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .flatMap((segment): SoccerwayFeedSegment[] => {
      if (segment.startsWith('AA÷')) return [{ type: 'match' as const, body: segment.slice(3) }];
      if (segment.startsWith('ZA÷')) return [{ type: 'competition' as const, body: segment }];
      return [];
    });
}

function buildFlashscoreLogoUrl(token: string | undefined): string | null {
  const value = String(token || '').trim();
  if (!value || !/\.png$/i.test(value)) return null;
  return `https://static.flashscore.com/res/image/data/${value}`;
}

function extractCompetitionHeaderTitle(segmentBody: string): string | null {
  const raw = segmentBody.split('¬')[0] || '';
  const value = raw.startsWith('ZA÷') ? raw.slice(3).trim() : raw.trim();
  return value || null;
}

function deriveCompetitionStage(params: {
  headerTitle: string | null;
  competitionCountry: string | null;
  competitionName: string | null;
}): string | null {
  const headerTitle = String(params.headerTitle || '').trim();
  const competitionCountry = String(params.competitionCountry || '').trim();
  const competitionName = String(params.competitionName || '').trim();
  if (!headerTitle || !competitionName) return null;

  let remainder = headerTitle;
  if (competitionCountry && remainder.toLowerCase().startsWith(`${competitionCountry.toLowerCase()}:`)) {
    remainder = remainder.slice(competitionCountry.length + 1).trim();
  }

  if (!remainder.toLowerCase().startsWith(competitionName.toLowerCase())) return null;
  remainder = remainder.slice(competitionName.length).trim().replace(/^[-:]\s*/, '').trim();
  return remainder || null;
}

export function parseSoccerwayTeamResultsHtml(html: string, limit?: number): SoccerwayRecentMatch[] {
  const segments = splitSoccerwayFeedSegments(html);
  const out: SoccerwayRecentMatch[] = [];
  const seenKeys = new Set<string>();
  let currentCompetitionName: string | null = null;
  let currentCompetitionCountry: string | null = null;

  for (const segment of segments) {
    if (segment.type === 'competition') {
      const fields = parseFeedFields(segment.body);
      currentCompetitionName = fields.ZK ?? null;
      currentCompetitionCountry = fields.ZY ?? null;
      continue;
    }

    const parts = segment.body.split('¬');
    const matchId = parts[0]?.trim() || null;
    if (!matchId) continue;

    const fields: Record<string, string> = {};
    for (let p = 1; p < parts.length; p += 1) {
      const seg = parts[p];
      const div = seg.indexOf('÷');
      if (div === -1) continue;
      const key = seg.slice(0, div);
      const val = seg.slice(div + 1);
      if (key) fields[key] = val;
    }

    const wu = fields.WU;
    const px = fields.PX;
    const wv = fields.WV;
    const py = fields.PY;
    const ae = fields.AE;
    const af = fields.AF;
    const ag = pickInt(fields.AG);
    const ah = pickInt(fields.AH);
    const kick = pickUnix(fields.AD);

    if (!wu || !px || !wv || !py || !ae || !af || ag == null || ah == null) continue;

    const summaryPath = `/match/${wu}-${px}/${wv}-${py}/summary/`;
    const dedupeKey = buildSoccerwayResultDedupeKey({ matchId, summaryPath });
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    out.push({
      matchId,
      homeTeam: ae,
      awayTeam: af,
      homeLogoUrl: buildFlashscoreLogoUrl(fields.OA),
      awayLogoUrl: buildFlashscoreLogoUrl(fields.OB),
      competitionName: fields.ZK ?? currentCompetitionName,
      competitionCountry: fields.ZY ?? currentCompetitionCountry,
      homeScore: ag,
      awayScore: ah,
      kickoffUnix: kick,
      summaryPath,
    });

    if (limit != null && out.length >= limit) break;
  }

  return out;
}

export function parseSoccerwayTeamFixturesHtml(html: string, limit?: number): SoccerwayUpcomingFixture[] {
  const segments = splitSoccerwayFeedSegments(html);
  const out: SoccerwayUpcomingFixture[] = [];
  const seenKeys = new Set<string>();
  let currentCompetitionName: string | null = null;
  let currentCompetitionCountry: string | null = null;
  let currentCompetitionStage: string | null = null;

  for (const segment of segments) {
    if (segment.type === 'competition') {
      const fields = parseFeedFields(segment.body);
      const competitionCountry = fields.ZY ?? null;
      const competitionName = fields.ZK ?? null;
      currentCompetitionName = competitionName;
      currentCompetitionCountry = competitionCountry;
      currentCompetitionStage = deriveCompetitionStage({
        headerTitle: extractCompetitionHeaderTitle(segment.body),
        competitionCountry,
        competitionName,
      });
      continue;
    }

    const parts = segment.body.split('¬');
    const matchId = parts[0]?.trim() || null;
    if (!matchId) continue;

    const fields: Record<string, string> = {};
    for (let p = 1; p < parts.length; p += 1) {
      const seg = parts[p];
      const div = seg.indexOf('÷');
      if (div === -1) continue;
      const key = seg.slice(0, div);
      const val = seg.slice(div + 1);
      if (key) fields[key] = val;
    }

    const wu = fields.WU;
    const px = fields.PX;
    const wv = fields.WV;
    const py = fields.PY;
    const ae = fields.AE;
    const af = fields.AF;
    const kick = pickUnix(fields.AD);

    if (!wu || !px || !wv || !py || !ae || !af) continue;

    const summaryPath = `/match/${wu}-${px}/${wv}-${py}/summary/`;
    const dedupeKey = buildSoccerwayResultDedupeKey({ matchId, summaryPath });
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    out.push({
      matchId,
      homeTeam: ae,
      awayTeam: af,
      kickoffUnix: kick,
      summaryPath,
      competitionName: fields.ZK ?? currentCompetitionName,
      competitionCountry: fields.ZY ?? currentCompetitionCountry,
      competitionStage: currentCompetitionStage,
      homeParticipantId: px,
      awayParticipantId: py,
      homeLogoUrl: buildFlashscoreLogoUrl(fields.OA),
      awayLogoUrl: buildFlashscoreLogoUrl(fields.OB),
    });

    if (limit != null && out.length >= limit) break;
  }

  return out;
}

export function extractSoccerwayFeedSign(html: string): string | null {
  const fromConfig = html.match(/"feed_sign":"([^"]+)"/);
  if (fromConfig?.[1]) return fromConfig[1];

  const fromLegacy = html.match(/var\s+feed_sign\s*=\s*'([^']+)'/);
  if (fromLegacy?.[1]) return fromLegacy[1];

  return null;
}

export function extractSoccerwayCountryId(html: string): string | null {
  const direct = html.match(/country_id\s*=\s*"([^"]+)"/);
  if (direct?.[1]) return direct[1];

  const env = html.match(/country_id:\s*"([^"]+)"/);
  if (env?.[1]) return env[1];

  return null;
}

export function extractSoccerwayEventId(html: string): string | null {
  return html.match(/"event_id_c":"([^"]+)"/)?.[1] ?? null;
}

export function detectSoccerwayLineupStatus(html: string): SoccerwayLineupStatus {
  if (/Predicted lineups/i.test(html)) return 'predicted';
  if (/Official lineups are usually available 1 hour before the match starts\./i.test(html)) return 'unavailable';
  return 'official';
}

export function buildSoccerwayLineupsPath(summaryPath: string): string {
  const normalized = String(summaryPath || '').trim();
  if (!normalized) return '';
  if (/\/summary\/lineups\/?$/i.test(normalized)) return normalized.replace(/\/+$/, '/');
  if (/\/summary\/?$/i.test(normalized)) return `${normalized.replace(/\/+$/, '')}/lineups/`;
  return `${normalized.replace(/\/+$/, '')}/lineups/`;
}

export function buildSoccerwayLineupsGraphqlUrl(eventId: string, projectId = 2020): string {
  return `https://2020.ds.lsapp.eu/pq_graphql?_hash=dlie2&eventId=${encodeURIComponent(eventId)}&projectId=${projectId}`;
}

export function buildSoccerwayPredictedLineupsGraphqlUrl(eventId: string, projectId = 2024): string {
  return `https://2024.ds.lsapp.eu/pq_graphql?_hash=dplie&eventId=${encodeURIComponent(eventId)}&projectId=${projectId}`;
}

type RawSoccerwayLineupPlayer = {
  id?: string | null;
  participantId?: string | null;
  fieldName?: string | null;
  listName?: string | null;
  number?: string | null;
  images?: Array<{ path?: string | null; variantType?: number | null }> | null;
  participant?: { url?: string | null } | null;
  playerRoles?: Array<{ title?: string | null; suffix?: string | null }> | null;
};

type RawSoccerwayLineupGroup = {
  playerIds?: string[] | null;
  players?: RawSoccerwayLineupPlayer[] | null;
};

type RawSoccerwayLineup = {
  players?: RawSoccerwayLineupPlayer[] | null;
  formation?: {
    name?: string | null;
    lines?: Array<{
      sortKey?: number | null;
      name?: string | null;
      rows?: Array<{
        sortKey?: number | null;
        playerIds?: Array<string | null> | null;
      }> | null;
    }> | null;
  } | null;
  groups?: Array<{
    sortKey?: number | null;
    name?: string | null;
    playerIds?: string[] | null;
  }> | null;
  coaches?: RawSoccerwayLineupGroup | null;
} | null;

type RawSoccerwayEventParticipant = {
  id?: string | null;
  name?: string | null;
  type?: { side?: string | null } | null;
  lineup?: RawSoccerwayLineup;
  predictedLineup?: RawSoccerwayLineup;
};

/** True when the official lineup payload can drive starters (avoid preferring predicted when both exist, e.g. after FT). */
function rawSoccerwayLineupHasStartersData(raw: RawSoccerwayLineup | null | undefined): boolean {
  if (!raw) return false;
  if (Array.isArray(raw.players) && raw.players.length > 0) return true;
  const startingGroup = raw.groups?.find((g) => /starting lineups?/i.test(String(g?.name || '')));
  if (startingGroup?.playerIds && startingGroup.playerIds.filter(Boolean).length > 0) return true;
  return Boolean(
    raw.formation?.lines?.some((line) =>
      line?.rows?.some((row) => (row?.playerIds?.filter((id) => id != null && id !== '') ?? []).length > 0)
    )
  );
}

function pickSourceLineup(raw: RawSoccerwayEventParticipant): RawSoccerwayLineup | null {
  if (rawSoccerwayLineupHasStartersData(raw.lineup)) return raw.lineup ?? null;
  if (rawSoccerwayLineupHasStartersData(raw.predictedLineup)) return raw.predictedLineup ?? null;
  return raw.lineup ?? raw.predictedLineup ?? null;
}

function pickSoccerwayPlayerImageUrl(
  images: Array<{ path?: string | null; variantType?: number | null }> | null | undefined
): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const preferred =
    images.find((image) => image?.path && image.variantType === 83) ??
    images.find((image) => image?.path && image.variantType === 82) ??
    images.find((image) => image?.path);
  const path = String(preferred?.path || '').trim();
  return path ? `https://static.flashscore.com/res/image/data/${path}` : null;
}

function normalizeSoccerwayLineupPlayer(raw: RawSoccerwayLineupPlayer, side: SoccerwayLineupSide): SoccerwayLineupPlayer | null {
  const id = String(raw?.id || raw?.participantId || '').trim();
  const fieldName = String(raw?.fieldName || '').trim();
  const listName = String(raw?.listName || fieldName).trim();
  if (!id || !fieldName) return null;
  return {
    id,
    participantId: String(raw?.participantId || '').trim() || null,
    side,
    fieldName,
    listName: listName || fieldName,
    number: String(raw?.number || '').trim() || null,
    participantUrl: raw?.participant?.url ? `/player/${String(raw.participant.url).trim()}/${id}/` : null,
    imageUrl: pickSoccerwayPlayerImageUrl(raw?.images),
    roleTitles: Array.isArray(raw?.playerRoles)
      ? raw.playerRoles.map((role) => String(role?.title || '').trim()).filter(Boolean)
      : [],
    roleSuffixes: Array.isArray(raw?.playerRoles)
      ? raw.playerRoles.map((role) => String(role?.suffix || '').trim()).filter(Boolean)
      : [],
  };
}

function normalizeSoccerwayLineupTeam(raw: RawSoccerwayEventParticipant): SoccerwayLineupTeam | null {
  const side = raw?.type?.side === 'AWAY' ? 'away' : raw?.type?.side === 'HOME' ? 'home' : null;
  const name = String(raw?.name || '').trim();
  if (!side || !name) return null;

  const sourceLineup = pickSourceLineup(raw);
  if (!sourceLineup) {
    return {
      side,
      participantId: String(raw?.id || '').trim() || null,
      name,
      formationName: null,
      starters: [],
      substitutes: [],
      coaches: [],
      formationLines: [],
    };
  }

  const playerMap = new Map<string, SoccerwayLineupPlayer>();
  for (const player of Array.isArray(sourceLineup.players) ? sourceLineup.players : []) {
    const normalized = normalizeSoccerwayLineupPlayer(player, side);
    if (normalized) playerMap.set(normalized.id, normalized);
  }

  const startingPlayerIds =
    sourceLineup.groups?.find((group) => /starting lineups?/i.test(String(group?.name || '')))?.playerIds?.filter(Boolean) ?? [];
  const substitutePlayerIds =
    sourceLineup.groups?.find((group) => /substitutes/i.test(String(group?.name || '')))?.playerIds?.filter(Boolean) ?? [];

  const starters = startingPlayerIds.map((id) => playerMap.get(id)).filter((player): player is SoccerwayLineupPlayer => player != null);
  const substitutes = substitutePlayerIds.map((id) => playerMap.get(id)).filter((player): player is SoccerwayLineupPlayer => player != null);

  const coaches = Array.isArray(sourceLineup.coaches?.players)
    ? sourceLineup.coaches.players
        .map((player) => normalizeSoccerwayLineupPlayer(player, side))
        .filter((player): player is SoccerwayLineupPlayer => player != null)
    : [];

  const formationLines =
    sourceLineup.formation?.lines?.map((line) => ({
      sortKey: Number.isFinite(line?.sortKey) ? Number(line.sortKey) : 0,
      name: String(line?.name || '').trim() || 'Line',
      rows:
        line?.rows?.map((row) => ({
          sortKey: Number.isFinite(row?.sortKey) ? Number(row.sortKey) : 0,
          players:
            row?.playerIds
              ?.map((playerId) => (playerId ? playerMap.get(playerId) : null))
              .filter((player): player is SoccerwayLineupPlayer => player != null) ?? [],
        })) ?? [],
    })) ?? [];

  return {
    side,
    participantId: String(raw?.id || '').trim() || null,
    name,
    formationName: String(sourceLineup.formation?.name || '').trim() || null,
    starters,
    substitutes,
    coaches,
    formationLines,
  };
}

export function parseSoccerwayLineupsGraphql(raw: string, statusHint: SoccerwayLineupStatus = 'official'): SoccerwayLineupBundle | null {
  try {
    const parsed = JSON.parse(raw) as {
      data?: {
        findEventById?: {
          eventParticipants?: RawSoccerwayEventParticipant[] | null;
        } | null;
      } | null;
    };

    const teams =
      parsed?.data?.findEventById?.eventParticipants
        ?.map((participant) => normalizeSoccerwayLineupTeam(participant))
        .filter((team): team is SoccerwayLineupTeam => team != null)
        .sort((a, b) => (a.side === b.side ? 0 : a.side === 'home' ? -1 : 1)) ?? [];

    const participants = parsed?.data?.findEventById?.eventParticipants ?? [];
    const hasPredictedLineup = participants.some((p) => p?.predictedLineup != null);
    const hasOfficialLineupData = participants.some((p) => rawSoccerwayLineupHasStartersData(p?.lineup ?? null));

    const hasLineupData = teams.some(
      (team) => team.starters.length > 0 || team.formationLines.length > 0 || team.substitutes.length > 0 || team.coaches.length > 0
    );
    const status: SoccerwayLineupStatus = !hasLineupData
      ? 'unavailable'
      : hasOfficialLineupData
        ? 'official'
        : hasPredictedLineup
          ? 'predicted'
          : statusHint;
    return {
      status,
      eventId: null,
      teams: hasLineupData ? teams : [],
    };
  } catch {
    return null;
  }
}

export function extractParticipantIdFromTeamHref(teamHref: string): string {
  return String(teamHref || '').trim().replace(/\/+$/, '').split('/').filter(Boolean).at(-1) || '';
}

export function buildSoccerwayParticipantResultsFeedUrl(params: {
  sportId?: number;
  countryId: string;
  participantId: string;
  page: number;
  timezoneHour?: number;
  language?: string;
  projectTypeId?: number;
}) {
  const {
    sportId = 1,
    countryId,
    participantId,
    page,
    timezoneHour = 0,
    language = 'en',
    projectTypeId = 1,
  } = params;

  return `https://global.flashscore.ninja/2020/x/feed/pr_${sportId}_${countryId}_${participantId}_${page}_${timezoneHour}_${language}_${projectTypeId}`;
}

export function buildSoccerwayMatchStatsFeedUrl(matchId: string, sportId = 1) {
  return `https://global.flashscore.ninja/2020/x/feed/df_st_${sportId}_${matchId}`;
}

export function buildSoccerwayTeamSquadUrl(teamHref: string): string {
  const normalized = String(teamHref || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  return `https://www.soccerway.com${normalized}/squad/`;
}

export function buildSoccerwayPlayerInjuryHistoryUrl(playerUrl: string | null | undefined): string {
  const normalized = String(playerUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  return `${normalized}/injury-history/`;
}

function parseFeedFields(segment: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of segment.split('¬')) {
    const div = part.indexOf('÷');
    if (div === -1) continue;
    const key = part.slice(0, div);
    const value = part.slice(div + 1);
    if (key) out[key] = value;
  }
  return out;
}

export function parseSoccerwayMatchStatsFeed(raw: string, feedUrl: string): SoccerwayMatchStats | null {
  const segments = raw
    .split('~')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const periods: SoccerwayMatchStatsPeriod[] = [];
  let currentPeriod: SoccerwayMatchStatsPeriod | null = null;
  let currentCategory: SoccerwayMatchStatsCategory | null = null;

  for (const segment of segments) {
    const fields = parseFeedFields(segment);

    if (fields.SE) {
      currentPeriod = {
        name: fields.SE,
        categories: [],
      };
      periods.push(currentPeriod);
      currentCategory = null;
      continue;
    }

    if (fields.SF) {
      if (!currentPeriod) {
        currentPeriod = { name: 'Match', categories: [] };
        periods.push(currentPeriod);
      }
      currentCategory = {
        name: fields.SF,
        stats: [],
      };
      currentPeriod.categories.push(currentCategory);
      continue;
    }

    if (fields.SG || fields.SH || fields.SI) {
      if (!currentPeriod) {
        currentPeriod = { name: 'Match', categories: [] };
        periods.push(currentPeriod);
      }
      if (!currentCategory) {
        currentCategory = { name: 'Stats', stats: [] };
        currentPeriod.categories.push(currentCategory);
      }
      currentCategory.stats.push({
        id: fields.SD ?? null,
        name: fields.SG || fields.SD || 'Stat',
        homeValue: fields.SH ?? null,
        awayValue: fields.SI ?? null,
        fields,
      });
    }
  }

  if (periods.length === 0) return null;

  return {
    feedUrl,
    periods,
    raw,
  };
}

export function parseSoccerwaySquadAbsencesHtml(html: string): SoccerwaySquadAbsence[] {
  const rows = [...html.matchAll(/<div class="lineupTable__row">([\s\S]*?)<\/div>\s*<\/div>/gi)];
  const out: SoccerwaySquadAbsence[] = [];
  const seen = new Set<string>();

  for (const match of rows) {
    const rowHtml = match[1];
    const playerMatch = rowHtml.match(/<a class="lineupTable__cell--name" href="([^"]+)">([\s\S]*?)<\/a>/i);
    const absenceMatch = rowHtml.match(/<svg class="lineupTable__cell--absence\s+([^"\s]+)[^"]*">[\s\S]*?<title>([\s\S]*?)<\/title>/i);
    if (!playerMatch || !absenceMatch) continue;

    const player = String(playerMatch[2] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!player) continue;

    const rawStatus = String(absenceMatch[1] || '').trim().toLowerCase();
    const status: SoccerwaySquadAbsence['status'] =
      rawStatus.includes('suspend') ? 'suspension' : rawStatus.includes('injur') ? 'injury' : 'absence';
    const reason = String(absenceMatch[2] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const playerUrl = playerMatch[1]?.trim() ? `https://www.soccerway.com${playerMatch[1].trim()}` : null;
    const dedupeKey = `${player.toLowerCase()}::${status}::${reason.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      player,
      status,
      reason,
      estimatedReturn: null,
      playerUrl,
    });
  }

  return out;
}

export function parseSoccerwayPlayerInjuryHistoryHtml(html: string): SoccerwayPlayerInjuryHistoryRow[] {
  const rowBlocks = [...html.matchAll(/<div class="injuryTable__row[^"]*">([\s\S]*?)<\/div>/gi)];

  return rowBlocks
    .map((match) => {
      const rowHtml = String(match[1] || '');
      const dates = [...rowHtml.matchAll(/<span[^>]*class="[^"]*injuryTable__date[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)].map((dateMatch) =>
        String(dateMatch[1] || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
      const injury = String(rowHtml.match(/<span class="injuryTable__typeInfo">([\s\S]*?)<\/span>/i)?.[1] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        from: dates[0] || '',
        until: dates[1] || '',
        injury,
      };
    })
    .filter((row) => row.from && row.until && row.injury);
}
