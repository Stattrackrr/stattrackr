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
