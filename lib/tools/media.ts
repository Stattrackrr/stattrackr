/**
 * Side images for tools cards: tennis headshots, NBA team logos, NBL fallback,
 * plus NBA player headshots for player-prop cards.
 */

import { nbaHeadshotUrl } from '@/lib/nba/dash/season';
import { nbaTeamLogoUrl } from '@/lib/nba/dash/teams';
import { nblTeamLogoUrl } from '@/lib/nblTeamCanonical';
import { PLAYER_ID_MAPPINGS } from '@/lib/playerIdMapping';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';
import { resolveTennisHeadshotUrlByName } from '@/lib/tennis/headshots';
import type { ToolsSport } from './types';

/** Pull player id from a resolved tennis headshot path/URL. */
function tennisIdFromResolved(resolved: string | null): string | null {
  if (!resolved) return null;
  const api = resolved.match(/\/api\/tennis\/headshot\/([^/?#]+)/i);
  if (api?.[1]) return decodeURIComponent(api[1]);
  const file = resolved.match(/\/images\/tennis\/headshots\/([^/?#]+)\.(?:jpg|jpeg|png|webp)/i);
  if (file?.[1]) return decodeURIComponent(file[1]);
  return null;
}

function normPerson(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Book / BDL nicknames that differ from the mapping's stored legal name. */
const NBA_HEADSHOT_NAME_ALIASES: Record<string, string> = {
  'ace bailey': 'airious bailey',
  'bub carrington': 'carlton carrington',
  'carlton carrington': 'carlton carrington',
  'bones hyland': 'nah shon hyland',
  'yang hansen': 'hansen yang',
  'hansen yang': 'hansen yang',
};

/** Resolve NBA CDN headshot from full or abbreviated board names ("Bam Adebayo" / "b adebayo"). */
export function toolsNbaPlayerHeadshot(name: string): string | null {
  const want = normPerson(name);
  if (!want) return null;
  const aliased = NBA_HEADSHOT_NAME_ALIASES[want] ? normPerson(NBA_HEADSHOT_NAME_ALIASES[want]) : want;
  const keys = [...new Set([want, aliased])];
  const parts = want.split(/\s+/).filter(Boolean);
  const hit =
    PLAYER_ID_MAPPINGS.find((m) => keys.includes(normPerson(m.name))) ||
    (parts.length >= 2
      ? PLAYER_ID_MAPPINGS.find((m) => {
          const mp = normPerson(m.name).split(/\s+/);
          const last = mp[mp.length - 1];
          const first = mp[0] ?? '';
          return last === parts[parts.length - 1] && first[0] === parts[0]![0];
        })
      : null) ||
    PLAYER_ID_MAPPINGS.find((m) => {
      const n = normPerson(m.name);
      return keys.some((k) => n.includes(k) || k.includes(n));
    });
  return hit?.nbaId ? nbaHeadshotUrl(hit.nbaId) : null;
}

export function toolsSideImage(sport: string, name: string): string | null {
  const label = String(name || '').trim();
  if (!label) return null;
  if (sport === 'tennis') {
    // Same assets props uses — prefer static /images/... without crop QS (tools uses object-cover).
    const resolved = resolveTennisHeadshotUrlByName(label);
    const id = tennisIdFromResolved(resolved);
    const url = clientTennisHeadshotUrl(id, resolved) || (id ? `/api/tennis/headshot/${encodeURIComponent(id)}` : null);
    return url ? url.split('?')[0]! : null;
  }
  if (sport === 'nba') {
    return nbaTeamLogoUrl(label);
  }
  if (sport === 'nbl') return nblTeamLogoUrl(label);
  return null;
}

/** Headshot for a player-prop subject (NBA CDN / tennis file). */
export function toolsPlayerImage(sport: string, playerName: string | null | undefined): string | null {
  const label = String(playerName || '').trim();
  if (!label) return null;
  if (sport === 'nba') return toolsNbaPlayerHeadshot(label);
  if (sport === 'tennis') return toolsSideImage('tennis', label);
  return null;
}

export function toolsMatchImages(
  sport: string,
  home: string,
  away: string
): { homeImageUrl: string | null; awayImageUrl: string | null } {
  return {
    homeImageUrl: toolsSideImage(sport, home),
    awayImageUrl: toolsSideImage(sport, away),
  };
}
