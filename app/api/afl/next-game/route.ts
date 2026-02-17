import { NextRequest, NextResponse } from 'next/server';
import { fetchSeasonMatches, type SeasonMatch } from '../match-lineup/route';
import {
  rosterTeamToInjuryTeam,
  opponentToOfficialTeamName,
  opponentToFootywireTeam,
  footywireNicknameToOfficial,
} from '@/lib/aflTeamMapping';

const FOOTYWIRE_BASE = 'https://www.footywire.com';
const FOOTYWIRE_FIXTURE_TTL = 1000 * 60 * 30; // 30 min
const footyWireFixtureCache = new Map<number, { expiresAt: number; matches: FootyWireMatch[] }>();

type FootyWireMatch = { round: string; home: string; away: string; tipoff_iso?: string };

function htmlToText(v: string): string {
  return v
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch and parse FootyWire fixture (shows upcoming games; AFLTables often only after completion). */
async function fetchFootyWireFixture(season: number): Promise<FootyWireMatch[]> {
  const cached = footyWireFixtureCache.get(season);
  if (cached && cached.expiresAt > Date.now()) return cached.matches;

  const url = `${FOOTYWIRE_BASE}/afl/footy/ft_match_list?year=${season}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-AU,en;q=0.9',
      Referer: 'https://www.footywire.com/',
    },
    next: { revalidate: 60 * 60 },
  });
  if (!res.ok) return [];
  const html = await res.text();

  const matches: FootyWireMatch[] = [];
  // Round headings: "Round 1", "Round 2", or links with round number
  const roundRegex = /Round\s*(\d+)|(?:^|[\s>"])R(\d+)(?:[\s<"]|$)/gi;
  const roundStarts: { index: number; round: string }[] = [];
  let rm: RegExpExecArray | null = null;
  while ((rm = roundRegex.exec(html)) !== null) {
    const num = rm[1] || rm[2];
    if (num) roundStarts.push({ index: rm.index, round: 'R' + num });
  }
  // Team links: href="th-..." or href="/afl/footy/th-...", link text = nickname (Blues, Eagles)
  const teamLinkRegex = /<a[^>]+href=['"](?:\/afl\/footy\/)?(th-[^'"]+)['"][^>]*>([^<]+)<\/a>/gi;
  const allLinks: { index: number; nickname: string }[] = [];
  let tm: RegExpExecArray | null = null;
  while ((tm = teamLinkRegex.exec(html)) !== null) {
    const text = htmlToText(tm[2]).trim();
    if (text && text.length < 25) allLinks.push({ index: tm.index, nickname: text });
  }
  const MONTH_ABBR: Record<string, number> = {
    Jan: 0, January: 0, Feb: 1, February: 1, Mar: 2, March: 2, Apr: 3, April: 3, May: 4, Jun: 5, June: 5,
    Jul: 6, July: 6, Aug: 7, August: 7, Sep: 8, September: 8, Oct: 9, October: 9, Nov: 10, November: 10, Dec: 11, December: 11,
  };
  // With time: "Fri 7 Mar 7:40pm" or "7 Mar 7:40 pm"
  const DATE_TIME_REGEX = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}):(\d{2})\s*(am|pm)/gi;
  // Date only: "Fri 7 Mar" or "7 Mar" (default 7:25pm AEST)
  const DATE_ONLY_REGEX = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s|$|[<\"'])/gi;

  function parseMatchTimeToISO(
    season: number,
    day: number,
    monthKey: string,
    hour: number,
    min: number,
    ampm: string
  ): string {
    const monthIndex = MONTH_ABBR[monthKey];
    if (monthIndex == null) return '';
    const hour24 = ampm.toLowerCase() === 'pm' ? (hour % 12) + 12 : hour % 12;
    let utcHour = hour24 - 10;
    let utcDay = day;
    if (utcHour < 0) {
      utcHour += 24;
      utcDay -= 1;
    }
    const d = new Date(Date.UTC(season, monthIndex, utcDay, utcHour, min, 0, 0));
    return d.toISOString();
  }

  function dateOnlyToISO(season: number, day: number, monthKey: string): string {
    const monthIndex = MONTH_ABBR[monthKey];
    if (monthIndex == null) return '';
    // Default bounce 7:25pm AEST -> 09:25 UTC
    const d = new Date(Date.UTC(season, monthIndex, day, 9, 25, 0, 0));
    return d.toISOString();
  }

  // Assign links to rounds by position, then pair consecutive links (home, away); parse dates per match
  for (let r = 0; r < roundStarts.length; r++) {
    const start = roundStarts[r].index;
    const end = r + 1 < roundStarts.length ? roundStarts[r + 1].index : html.length;
    const roundLabel = roundStarts[r].round;
    const roundHtml = html.slice(start, end);
    const dateArr: { day: number; month: string; hour?: number; min?: number; ampm?: string }[] = [];
    let dm: RegExpExecArray | null = null;
    DATE_TIME_REGEX.lastIndex = 0;
    while ((dm = DATE_TIME_REGEX.exec(roundHtml)) !== null) {
      dateArr.push({
        day: parseInt(dm[1], 10),
        month: dm[2],
        hour: parseInt(dm[3], 10),
        min: parseInt(dm[4], 10),
        ampm: dm[5],
      });
    }
    if (dateArr.length === 0) {
      DATE_ONLY_REGEX.lastIndex = 0;
      while ((dm = DATE_ONLY_REGEX.exec(roundHtml)) !== null) {
        dateArr.push({ day: parseInt(dm[1], 10), month: dm[2] });
      }
    }
    const linksInRound = allLinks.filter((l) => l.index >= start && l.index < end);
    for (let i = 0; i + 1 < linksInRound.length; i += 2) {
      const dateInfo = dateArr[i];
      let tipoff_iso: string | undefined;
      if (dateInfo && dateInfo.day != null && dateInfo.month) {
        if (
          dateInfo.hour != null &&
          dateInfo.min != null &&
          dateInfo.ampm &&
          Number.isFinite(dateInfo.hour) &&
          Number.isFinite(dateInfo.min)
        ) {
          tipoff_iso = parseMatchTimeToISO(
            season,
            dateInfo.day,
            dateInfo.month,
            dateInfo.hour,
            dateInfo.min,
            dateInfo.ampm
          );
        } else {
          tipoff_iso = dateOnlyToISO(season, dateInfo.day, dateInfo.month);
        }
      }
      matches.push({
        round: roundLabel,
        home: linksInRound[i].nickname,
        away: linksInRound[i + 1].nickname,
        ...(tipoff_iso ? { tipoff_iso } : {}),
      });
    }
  }
  if (matches.length > 0) {
    footyWireFixtureCache.set(season, { expiresAt: Date.now() + FOOTYWIRE_FIXTURE_TTL, matches });
  }
  return matches;
}

/** Normalize for matching: lowercase, collapse spaces/punctuation. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamMatches(pageTeam: string, requestedTeam: string): boolean {
  if (!requestedTeam) return false;
  const a = normalize(pageTeam);
  const b = normalize(requestedTeam);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aWords = a.split(' ').filter(Boolean);
  const bWords = b.split(' ').filter(Boolean);
  return aWords.some((w) => b.includes(w)) || bWords.some((w) => a.includes(w));
}

/** First word for AFLTables (e.g. "Sydney Swans" -> "Sydney"). */
function shortName(full: string): string {
  const t = full.trim();
  if (!t) return t;
  const first = t.split(/\s+/)[0];
  return first && first.length >= 2 ? first : t;
}

/** Round order for "next" after last_round: R0 (opening round), R1..R24 then finals. */
const ROUND_ORDER = [
  'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10',
  'R11', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18', 'R19', 'R20',
  'R21', 'R22', 'R23', 'R24',
  'QF', 'EF', 'SF', 'PF', 'GF',
];

function normalizeRoundLabel(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().toUpperCase();
  if (/^R\d+$/.test(t)) return t;
  if (/^\d+$/.test(t)) return 'R' + t;
  if (t.includes('GRAND') || t === 'GF') return 'GF';
  if (t.includes('PRELIMINARY') || t === 'PF') return 'PF';
  if (t.includes('SEMI') || t === 'SF') return 'SF';
  if (t.includes('QUALIFYING') || t === 'QF') return 'QF';
  if (t.includes('ELIMINATION') || t === 'EF') return 'EF';
  if (t.includes('ROUND') && /\d+/.test(t)) return 'R' + (t.match(/\d+/)?.[0] ?? '');
  return t;
}

function roundOrderIndex(round: string): number {
  const r = normalizeRoundLabel(round);
  const i = ROUND_ORDER.indexOf(r);
  return i >= 0 ? i : 999;
}

function footyWireTeamAliases(teamFull: string, teamNickname: string): Set<string> {
  return new Set<string>(
    [teamNickname.trim(), teamFull.trim(), shortName(teamFull).trim()]
      .map((s) => normalize(s))
      .filter(Boolean)
  );
}

/** Find the team's next match: first match where team plays and round >= nextRoundStart. */
function findNextMatch(
  matches: SeasonMatch[],
  teamFull: string,
  nextRoundStart: string
): SeasonMatch | null {
  const teamAlts = [teamFull, shortName(teamFull)].filter(Boolean);
  const startIdx = roundOrderIndex(nextRoundStart);
  let best: SeasonMatch | null = null;
  let bestIdx = 999;
  for (const m of matches) {
    const teamIn = teamAlts.some((t) => teamMatches(m.home, t) || teamMatches(m.away, t));
    if (!teamIn) continue;
    const idx = roundOrderIndex(m.round);
    if (idx >= startIdx && idx < bestIdx) {
      bestIdx = idx;
      best = m;
    }
  }
  return best;
}

/** Find next match from FootyWire fixture (nickname-based). Prefer the chronologically earliest match that has tipoff_iso so we can show a countdown. */
function findNextMatchFootyWire(
  matches: FootyWireMatch[],
  teamNickname: string,
  teamFull: string,
  nextRoundStart: string
): FootyWireMatch | null {
  const startIdx = roundOrderIndex(nextRoundStart);
  const aliases = footyWireTeamAliases(teamFull, teamNickname);
  const now = Date.now();

  const relevant = matches.filter((m) => {
    const homeNorm = normalize(m.home);
    const awayNorm = normalize(m.away);
    return aliases.has(homeNorm) || aliases.has(awayNorm);
  });
  if (relevant.length === 0) return null;

  // Primary strategy: pick the nearest upcoming fixture by parsed tipoff time.
  // This avoids selecting early-season rounds that are already completed.
  const upcomingByTime = relevant
    .map((m) => ({ m, ts: m.tipoff_iso ? Date.parse(m.tipoff_iso) : Number.NaN }))
    .filter((row) => Number.isFinite(row.ts) && row.ts >= now)
    .sort((a, b) => a.ts - b.ts);
  if (upcomingByTime.length > 0) return upcomingByTime[0].m;

  // Secondary strategy: if round context is valid, choose earliest match in/after that round.
  const fromRound = relevant.filter((m) => roundOrderIndex(m.round) >= startIdx);
  if (fromRound.length > 0) {
    fromRound.sort((a, b) => roundOrderIndex(a.round) - roundOrderIndex(b.round));
    return fromRound[0];
  }

  // Last resort: return earliest known round for the team.
  relevant.sort((a, b) => roundOrderIndex(a.round) - roundOrderIndex(b.round));
  return relevant[0];

  /*
   * Legacy round-only selection kept for reference.
   */
  /*
  let best: FootyWireMatch | null = null;
  let bestIdx = 999;
  let bestWithTime: FootyWireMatch | null = null;
  let bestWithTimeIdx = 999;
  for (const m of matches) {
    const teamIn = m.home === nick || m.away === nick;
    if (!teamIn) continue;
    const idx = roundOrderIndex(m.round);
    if (idx >= startIdx && idx < bestIdx) {
      bestIdx = idx;
      best = m;
    }
    if (idx >= startIdx && m.tipoff_iso && idx < bestWithTimeIdx) {
      bestWithTimeIdx = idx;
      bestWithTime = m;
    }
  }
  return bestWithTime ?? best;
  */
}

export async function GET(request: NextRequest) {
  const teamParam = request.nextUrl.searchParams.get('team')?.trim();
  const seasonParam = request.nextUrl.searchParams.get('season');
  const lastRoundParam = request.nextUrl.searchParams.get('last_round')?.trim();
  const debug = request.nextUrl.searchParams.get('debug') === '1' || request.nextUrl.searchParams.get('debug') === 'true';

  if (!teamParam) {
    return NextResponse.json(
      {
        error: 'team query param required',
        example: `${request.nextUrl.origin}/api/afl/next-game?team=Essendon&season=2026`,
        example_with_debug: `${request.nextUrl.origin}/api/afl/next-game?team=Essendon&season=2026&debug=1`,
      },
      { status: 400 }
    );
  }
  const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(season)) {
    return NextResponse.json({ error: 'season must be a year (e.g. 2025)' }, { status: 400 });
  }

  try {
    const teamFull = rosterTeamToInjuryTeam(teamParam) || teamParam;
    const teamNickname = opponentToFootywireTeam(teamFull) || opponentToFootywireTeam(teamParam) || '';

    // Next round: for 2026 always use R0 (opening round) so we show next 2026 match, not 2025's last opponent.
    // When game logs are from 2025 fallback, last_round is 2025's round; we want 2026's first match.
    let nextRoundStart = 'R0';
    if (season !== 2026 && lastRoundParam) {
      const lastNorm = normalizeRoundLabel(lastRoundParam);
      const lastIdx = ROUND_ORDER.indexOf(lastNorm);
      if (lastIdx >= 0 && lastIdx < ROUND_ORDER.length - 1) {
        nextRoundStart = ROUND_ORDER[lastIdx + 1];
      } else if (lastIdx >= 0) {
        nextRoundStart = 'R99'; // GF or last round — no next round
      }
    }

    const emptyResponse = (source: string, debugPayload?: object) =>
      NextResponse.json({
        season,
        team: teamFull,
        next_opponent: null,
        next_round: null,
        next_game_tipoff: null,
        match_url: null,
        source,
        ...(debug ? { _debug: debugPayload } : {}),
      });

    // Prefer FootyWire fixture (shows upcoming games; AFLTables often only after completion).
    const fwMatches = await fetchFootyWireFixture(season);
    if (fwMatches.length > 0 && teamNickname) {
      const nextMatch = findNextMatchFootyWire(fwMatches, teamNickname, teamFull, nextRoundStart);
      if (nextMatch) {
        const aliases = footyWireTeamAliases(teamFull, teamNickname);
        const teamIsHome = aliases.has(normalize(nextMatch.home));
        const opponentNickname = teamIsHome ? nextMatch.away : nextMatch.home;
        const nextOpponentFull = footywireNicknameToOfficial(opponentNickname) || opponentNickname;
        const body: Record<string, unknown> = {
          season,
          team: teamFull,
          next_opponent: nextOpponentFull,
          next_round: nextMatch.round,
          next_game_tipoff: nextMatch.tipoff_iso ?? null,
          match_url: null,
          source: 'footywire.com',
        };
        if (debug) {
          const withTipoff = fwMatches.filter((m) => m.tipoff_iso).length;
          body._debug = {
            next_match: { round: nextMatch.round, home: nextMatch.home, away: nextMatch.away, tipoff_iso: nextMatch.tipoff_iso ?? null },
            fixture_total_matches: fwMatches.length,
            fixture_matches_with_parsed_time: withTipoff,
            first_three_matches: fwMatches.slice(0, 3).map((m) => ({ round: m.round, home: m.home, away: m.away, tipoff_iso: m.tipoff_iso ?? null })),
          };
        }
        return NextResponse.json(body);
      }
    }

    // Fallback: AFLTables season page (often only has completed matches).
    const matches = await fetchSeasonMatches(season);
    if (matches.length === 0) return emptyResponse('afltables.com', debug ? { reason: 'no_matches_from_afltables' } : undefined);

    const nextMatch = findNextMatch(matches, teamFull, nextRoundStart);
    if (!nextMatch) return emptyResponse('afltables.com', debug ? { reason: 'no_next_match_found' } : undefined);

    const opponentRaw =
      teamMatches(nextMatch.home, teamFull) || teamMatches(nextMatch.home, shortName(teamFull))
        ? nextMatch.away
        : nextMatch.home;
    const nextOpponentFull = opponentToOfficialTeamName(opponentRaw) || opponentRaw;

    const aflTablesBody: Record<string, unknown> = {
      season,
      team: teamFull,
      next_opponent: nextOpponentFull,
      next_round: nextMatch.round,
      next_game_tipoff: null,
      match_url: nextMatch.match_url,
      source: 'afltables.com',
    };
    if (debug) aflTablesBody._debug = { note: 'AFLTables does not provide match times; only FootyWire fixture can return next_game_tipoff' };
    return NextResponse.json(aflTablesBody);
  } catch (err) {
    console.error('[AFL next-game]', err);
    return NextResponse.json(
      { error: 'Failed to fetch next game', details: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
