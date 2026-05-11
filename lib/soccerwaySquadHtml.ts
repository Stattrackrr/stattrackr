import { buildSoccerwayTeamSquadUrl } from '@/lib/soccerwayTeamResults';
import { normalizeSoccerTeamHref } from '@/lib/soccerCache';

const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

export type SoccerwaySquadListPlayer = {
  playerKey: string;
  displayName: string;
};

/**
 * Parses squad tables from a Soccerway /team/{slug}/{id}/squad/ HTML page.
 */
export function parseSoccerwaySquadPlayerTableHtml(html: string): SoccerwaySquadListPlayer[] {
  const re = /<a class="lineupTable__cell--name" href="\/player\/([^/]+)\/[^/"]+\/">\s*([\s\S]*?)<\/a>/gi;
  const byKey = new Map<string, SoccerwaySquadListPlayer>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const playerKey = String(m[1] || '')
      .trim()
      .toLowerCase();
    const displayName = String(m[2] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!playerKey || !displayName) continue;
    if (!byKey.has(playerKey)) byKey.set(playerKey, { playerKey, displayName });
  }
  return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function fetchSoccerwaySquadPlayers(teamHref: string): Promise<SoccerwaySquadListPlayer[]> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  const url = buildSoccerwayTeamSquadUrl(normalized);
  if (!url) return [];
  const response = await fetch(url, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Soccerway squad page returned ${response.status}`);
  return parseSoccerwaySquadPlayerTableHtml(await response.text());
}
