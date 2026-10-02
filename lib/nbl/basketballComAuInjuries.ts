/**
 * Scrape NBL injury list from basketball.com.au.
 *
 * Primary source (current season): the living "NBL Injury Report" page, which
 * renders one `<table class="basketballcomau-inj">` per club with
 * Player / Status / Injury / Return columns plus a free-text note row.
 *
 * Legacy fallback: the season roster-tracker article with `Injuries:` lists
 * (used when the report page yields no rows).
 *
 * Shape matches AFL injuries: { team, player, injury, returning } plus
 * optional `status` / `note` / `listedByNbl` from the report table.
 */

import {
  NBL_CLUBS,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';

export type NblInjuryRow = {
  team: string;
  player: string;
  injury: string;
  returning: string;
  /** Status column from the injury report (e.g. "Out", "Out for the season", "Day-to-Day"). */
  status?: string;
  /** Free-text note row under the player in the injury report. */
  note?: string;
  /** True when the page marks the row as on the NBL's own injury list. */
  listedByNbl?: boolean;
};

export const NBL_INJURIES_SOURCE_URL = 'https://www.basketball.com.au/news/nbl-injury-report';

export const NBL_INJURIES_LEGACY_SOURCE_URL =
  'https://www.basketball.com.au/news/2025-26-nbl-team-lists-and-roster-tracker';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-AU,en;q=0.9',
};

function decodeEntities(value: string): string {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x27;|&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u200d/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '));
}

function canonicalTeam(name: string): string {
  return resolveNblClubName(name) || name;
}

/** Split "Player: detail" / "Player (detail): return" into AFL-shaped fields. */
export function parseNblInjuryLine(raw: string): Omit<NblInjuryRow, 'team'> | null {
  const text = stripTags(raw);
  if (!text || text.length < 3) return null;
  // Skip roster / incoming noise
  if (/^(IP|DP|IRP)\b/i.test(text)) return null;
  if (/\b(from|signed with|replacement for|released)\b/i.test(text) && !/:\s*/.test(text)) {
    return null;
  }

  // Name (injury): returning
  let m = text.match(/^(.+?)\s*\(([^)]+)\)\s*:\s*(.+)$/);
  if (m) {
    return {
      player: m[1].trim(),
      injury: m[2].trim(),
      returning: m[3].trim(),
    };
  }

  // Name: rest
  m = text.match(/^([^:]+):\s*(.+)$/);
  if (m) {
    const player = m[1].trim().replace(/\s+/g, ' ');
    const rest = m[2].trim();

    // "Foot - Round 15" / "Wrist - Season"
    const dash = rest.match(/^(.+?)\s+-\s+(.+)$/);
    if (dash) {
      return {
        player,
        injury: dash[1].trim(),
        returning: dash[2].trim(),
      };
    }

    // "Hamstring (season)" / "Leg (No Timetable)" / "Knee (status uncertain)"
    const parenEnd = rest.match(/^(.+?)\s*\(([^)]+)\)\s*\.?$/);
    if (parenEnd && parenEnd[1].trim().length < 80) {
      return {
        player,
        injury: parenEnd[1].trim(),
        returning: parenEnd[2].trim(),
      };
    }

    // "Ruptured ACL. Season."
    const seasonDot = rest.match(/^(.+?)\.\s*(Season|Likely Season)\.?$/i);
    if (seasonDot) {
      return {
        player,
        injury: seasonDot[1].trim(),
        returning: seasonDot[2].trim(),
      };
    }

    // Long description with "(Expected back …)" at end
    const expected = rest.match(/^(.*?)\s*\((Expected\s+back[^)]*)\)\s*\.?$/i);
    if (expected) {
      return {
        player,
        injury: expected[1].trim().replace(/[.\s]+$/, ''),
        returning: expected[2].trim(),
      };
    }

    // Pull a return phrase off the end
    const ret = rest.match(
      /^(.*?)(?:\.\s*)?\b(Out(?:\s+of)?\s+the\s+rest\s+of\s+the\s+season|Out\s+the\s+rest\s+of\s+the\s+season|No timetable(?:\s+for\s+return)?|Not timetable)\.?$/i
    );
    if (ret && ret[1].trim()) {
      return {
        player,
        injury: ret[1].trim().replace(/[.\s]+$/, ''),
        returning: ret[2].trim(),
      };
    }

    return { player, injury: rest, returning: '—' };
  }

  // "Sean Macdonald Knee (Season)" — no colon
  m = text.match(
    /^([A-Za-z][A-Za-z'''\-]+(?:\s+[A-Za-z][A-Za-z'''\-]+)+)\s+(.+?)\s*\(([^)]+)\)\s*$/
  );
  if (m) {
    return {
      player: m[1].trim(),
      injury: m[2].trim(),
      returning: m[3].trim(),
    };
  }

  return null;
}

function extractListItems(ulHtml: string): string[] {
  return [...ulHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
}

/**
 * Parse roster-tracker HTML into injury rows.
 */
export function parseBasketballComAuInjuriesHtml(html: string): NblInjuryRow[] {
  const clean = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const clubNames = NBL_CLUBS.map((c) => c.name);
  // Prefer h3 team sections (Webflow article body)
  const headingRe = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
  const headings: Array<{ team: string; index: number }> = [];
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(clean))) {
    const title = stripTags(hm[1]);
    const team = clubNames.find(
      (c) =>
        normalizeTeamKey(title) === normalizeTeamKey(c) ||
        normalizeTeamKey(title).includes(normalizeTeamKey(c)) ||
        normalizeTeamKey(c).includes(normalizeTeamKey(title))
    );
    if (team) headings.push({ team, index: hm.index });
  }

  // Fallback: locate first strong occurrence of each club name as a section start
  if (headings.length < 5) {
    headings.length = 0;
    for (const club of clubNames) {
      const needle = club;
      const idx = clean.indexOf(needle);
      if (idx >= 0) headings.push({ team: club, index: idx });
    }
    headings.sort((a, b) => a.index - b.index);
  }

  const out: NblInjuryRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < headings.length; i++) {
    const { team, index } = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].index : clean.length;
    const section = clean.slice(index, end);

    // Find Injuries / Injuries: / Injuries / Outs heading, then the next <ul>
    const injuryHeading = section.search(/>\s*Injuries(?:\s*\/\s*Outs)?\s*:?\s*</i);
    if (injuryHeading < 0) continue;

    const afterHeading = section.slice(injuryHeading);
    // Stop before Incoming / Departed if those appear before the ul... usually ul is immediate
    const incomingPos = afterHeading.search(/>\s*Incoming Players\s*</i);
    const departedPos = afterHeading.search(/>\s*Departed Players\s*</i);
    const stopAt = Math.min(
      incomingPos >= 0 ? incomingPos : Infinity,
      departedPos >= 0 ? departedPos : Infinity,
      800
    );
    const window = afterHeading.slice(0, Number.isFinite(stopAt) ? stopAt : 800);
    const ulStart = window.indexOf('<ul');
    if (ulStart < 0) continue;
    const ulEnd = window.indexOf('</ul>', ulStart);
    if (ulEnd < 0) continue;
    const items = extractListItems(window.slice(ulStart, ulEnd + 5));

    for (const item of items) {
      const parsed = parseNblInjuryLine(item);
      if (!parsed?.player) continue;
      const teamName = canonicalTeam(team);
      const key = `${normalizeTeamKey(teamName)}|${normalizeTeamKey(parsed.player)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        team: teamName,
        player: parsed.player,
        injury: parsed.injury || '—',
        returning: parsed.returning || '—',
      });
    }
  }

  return out;
}

function isAvailableStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return !s || s === 'available' || s === 'fit' || s === 'cleared' || s === 'healthy';
}

function matchClubFromHeading(title: string): string | null {
  const key = normalizeTeamKey(title);
  if (!key) return null;
  for (const club of NBL_CLUBS) {
    const ck = normalizeTeamKey(club.name);
    if (key === ck || key.includes(ck) || ck.includes(key)) return club.name;
  }
  return resolveNblClubName(title) || null;
}

/**
 * Parse the current-season "NBL Injury Report" page.
 *
 * Structure per club:
 *   <h3 id="club-slug">Club Name – N injuries</h3>
 *   <table class="... basketballcomau-inj">
 *     <tr data-status="listed|clear|..."><th scope="row">Player</th>
 *       <td class="s o">Out</td><td>Injury</td><td>Return</td></tr>
 *     <tr class="n" data-status="..."><td colspan="4">note…</td></tr>
 *
 * Only rows whose Status is not "Available" are returned.
 */
export function parseBasketballComAuInjuryReportHtml(html: string): NblInjuryRow[] {
  const clean = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const out: NblInjuryRow[] = [];
  const seen = new Set<string>();

  const tableRe = /<table\b[^>]*basketballcomau-inj[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(clean))) {
    // Nearest preceding <h3> is the club heading.
    const before = clean.slice(Math.max(0, tm.index - 4000), tm.index);
    const headings = [...before.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    const headingHtml = headings.length ? headings[headings.length - 1][1] : '';
    const headingText = stripTags(headingHtml).replace(/\s*[–-]\s*(no|\d+)\s+injur(?:y|ies).*$/i, '');
    const team = matchClubFromHeading(headingText);
    if (!team) continue;

    const rows = [...tm[1].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
    for (let i = 0; i < rows.length; i++) {
      const attrs = rows[i][1] || '';
      const body = rows[i][2] || '';
      if (/class="[^"]*\bn\b[^"]*"/i.test(attrs)) continue; // note rows handled below
      const nameMatch = body.match(/<th\b[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/i);
      if (!nameMatch) continue;
      const player = stripTags(nameMatch[1]);
      if (!player) continue;
      const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
      const status = cells[0] || '';
      if (isAvailableStatus(status)) continue;
      const injury = cells[1] || '';
      const returning = cells[2] || '';
      const dataStatus = (attrs.match(/data-status="([^"]*)"/i) || [])[1] || '';

      let note: string | undefined;
      const next = rows[i + 1];
      if (next && /class="[^"]*\bn\b[^"]*"/i.test(next[1] || '')) {
        const noteCell = (next[2] || '').match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
        const text = noteCell ? stripTags(noteCell[1]) : '';
        if (text) note = text;
      }

      const key = `${normalizeTeamKey(team)}|${normalizeTeamKey(player)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        team,
        player,
        injury: injury || '—',
        returning: returning || '—',
        status,
        ...(note ? { note } : {}),
        listedByNbl: dataStatus.toLowerCase() === 'listed',
      });
    }
  }

  return out;
}

/** "last updated on Tuesday, September 29, 4:00pm AEST" as printed on the report page. */
export function extractInjuryReportUpdatedText(html: string): string | null {
  const text = stripTags(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' '));
  const m = text.match(/last updated on ([^;.]{6,80})/i);
  return m ? m[1].trim() : null;
}

export async function fetchNblInjuriesFromBasketballComAu(): Promise<{
  injuries: NblInjuryRow[];
  sourceUrl: string;
  sourceUpdatedText: string | null;
}> {
  const res = await fetch(NBL_INJURIES_SOURCE_URL, {
    headers: FETCH_HEADERS,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`basketball.com.au injuries HTTP ${res.status}`);
  }
  const html = await res.text();
  const injuries = parseBasketballComAuInjuryReportHtml(html);
  if (injuries.length) {
    return {
      injuries,
      sourceUrl: NBL_INJURIES_SOURCE_URL,
      sourceUpdatedText: extractInjuryReportUpdatedText(html),
    };
  }

  // Fallback: legacy roster-tracker article.
  const legacy = await fetch(NBL_INJURIES_LEGACY_SOURCE_URL, {
    headers: FETCH_HEADERS,
    cache: 'no-store',
  });
  if (!legacy.ok) {
    throw new Error(`basketball.com.au legacy injuries HTTP ${legacy.status}`);
  }
  const legacyHtml = await legacy.text();
  return {
    injuries: parseBasketballComAuInjuriesHtml(legacyHtml),
    sourceUrl: NBL_INJURIES_LEGACY_SOURCE_URL,
    sourceUpdatedText: null,
  };
}
