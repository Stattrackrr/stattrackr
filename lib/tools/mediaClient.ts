/**
 * Client-safe image helpers for the tools board (no fs / Node APIs).
 */

import { nbaTeamLogoUrl } from '@/lib/nba/dash/teams';
import { nblTeamLogoUrl } from '@/lib/nblTeamCanonical';

/** Client-safe NBA logo resolve when the API omitted image URLs. */
export function clientNbaLogo(name: string | null | undefined): string | null {
  return nbaTeamLogoUrl(String(name || '').trim()) || null;
}

/** Client-safe NBL crest when the API omitted image URLs. */
export function clientNblLogo(name: string | null | undefined): string | null {
  return nblTeamLogoUrl(String(name || '').trim()) || null;
}
