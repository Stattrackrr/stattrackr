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

function pickInt(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function pickUnix(raw: string | undefined): number | null {
  const n = pickInt(raw);
  return n != null && n > 1_000_000_000 ? n : null;
}

function splitSoccerwayFeedChunks(raw: string): string[] {
  if (raw.includes('~AA÷')) return raw.split('~AA÷');
  return raw.split('~AA').map((chunk, idx) => (idx === 0 ? chunk : chunk.replace(/^[^A-Za-z0-9]+/, '')));
}

function buildFlashscoreLogoUrl(token: string | undefined): string | null {
  const value = String(token || '').trim();
  if (!value || !/\.png$/i.test(value)) return null;
  return `https://static.flashscore.com/res/image/data/${value}`;
}

export function parseSoccerwayTeamResultsHtml(html: string, limit?: number): SoccerwayRecentMatch[] {
  const chunks = splitSoccerwayFeedChunks(html);
  const out: SoccerwayRecentMatch[] = [];
  const seenPath = new Set<string>();

  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const parts = chunk.split('¬');
    const matchId = parts[0]?.includes('÷') ? null : parts[0];
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
    if (seenPath.has(summaryPath)) continue;
    seenPath.add(summaryPath);

    out.push({
      matchId,
      homeTeam: ae,
      awayTeam: af,
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
  const chunks = splitSoccerwayFeedChunks(html);
  const out: SoccerwayUpcomingFixture[] = [];
  const seenPath = new Set<string>();

  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const parts = chunk.split('¬');
    const matchId = parts[0]?.includes('÷') ? null : parts[0];
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
    if (seenPath.has(summaryPath)) continue;
    seenPath.add(summaryPath);

    out.push({
      matchId,
      homeTeam: ae,
      awayTeam: af,
      kickoffUnix: kick,
      summaryPath,
      competitionName: fields.ZK ?? null,
      competitionCountry: fields.ZY ?? null,
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
