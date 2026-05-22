import { buildSoccerwayTeamSquadUrl } from '@/lib/soccerwayTeamResults';
import { normalizeSoccerTeamHref } from '@/lib/soccerCache';
import { normalizeSoccerPositionCode } from '@/lib/soccerPlayerPosition';

export const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

export type SoccerwaySquadListPlayer = {
  playerKey: string;
  displayName: string;
  /** Best available squad-page group/code fallback. Match-row roles remain the source of truth. */
  position?: string | null;
  positionRaw?: string | null;
};

export type ParseSoccerwaySquadOptions = {
  /** `name` (default): A–Z for roster UIs. `document`: first appearance in HTML (squad table order on Soccerway). */
  sort?: 'name' | 'document';
};

/**
 * Parses squad tables from a Soccerway /team/{slug}/{id}/squad/ HTML page.
 */
export function parseSoccerwaySquadPlayerTableHtml(html: string, opts?: ParseSoccerwaySquadOptions): SoccerwaySquadListPlayer[] {
  const re = /<a class="lineupTable__cell--name" href="\/player\/([^/]+)\/[^/"]+\/">\s*([\s\S]*?)<\/a>/gi;
  const byKey = new Map<string, SoccerwaySquadListPlayer>();
  let currentPositionRaw: string | null = null;
  let previousEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    currentPositionRaw = extractLatestSquadPositionGroup(html.slice(previousEnd, m.index)) ?? currentPositionRaw;
    previousEnd = re.lastIndex;
    const playerKey = String(m[1] || '')
      .trim()
      .toLowerCase();
    const displayName = String(m[2] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!playerKey || !displayName) continue;
    const position = normalizeSoccerPositionCode(currentPositionRaw);
    if (!byKey.has(playerKey)) {
      byKey.set(playerKey, { playerKey, displayName, position, positionRaw: currentPositionRaw });
    } else {
      const existing = byKey.get(playerKey)!;
      if (!existing.position && position) {
        byKey.set(playerKey, { ...existing, position, positionRaw: currentPositionRaw });
      }
    }
  }
  const list = [...byKey.values()];
  if (opts?.sort === 'document') return list;
  return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function extractLatestSquadPositionGroup(fragment: string): string | null {
  const text = String(fragment || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  const groupRe = /\b(goalkeepers?|keepers?|defenders?|backs?|midfielders?|forwards?|attackers?|strikers?)\b/gi;
  let latest: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = groupRe.exec(text)) !== null) {
    const raw = match[1]?.toLowerCase() ?? '';
    if (raw.startsWith('goal') || raw.startsWith('keeper')) latest = 'goalkeeper';
    else if (raw.startsWith('def') || raw.startsWith('back')) latest = 'defender';
    else if (raw.startsWith('mid')) latest = 'midfielder';
    else if (raw.startsWith('forw') || raw.startsWith('attack') || raw.startsWith('striker')) latest = 'forward';
  }
  return latest;
}

export async function fetchSoccerwaySquadPlayers(
  teamHref: string,
  opts?: ParseSoccerwaySquadOptions
): Promise<SoccerwaySquadListPlayer[]> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  const url = buildSoccerwayTeamSquadUrl(normalized);
  if (!url) return [];
  const response = await fetch(url, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Soccerway squad page returned ${response.status}`);
  return parseSoccerwaySquadPlayerTableHtml(await response.text(), opts);
}
