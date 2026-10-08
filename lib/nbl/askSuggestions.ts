import { getNblClubByCode, resolveNblClubName } from '@/lib/nblTeamCanonical';

function lastName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).at(-1) || name;
}

function opponentLabel(opponent: string): string {
  const raw = String(opponent || '').trim();
  if (!raw || raw === 'All') return '';
  return getNblClubByCode(raw)?.name || resolveNblClubName(raw) || raw;
}

/** Fixed chips for the Model tab. Same three for every stat on this player vs opponent. */
export function nblPunterQuestions(playerName: string, opponentName: string): string[] {
  const last = lastName(playerName) || 'this player';
  const opp = opponentLabel(opponentName);
  if (!playerName.trim() || !opp) return [];
  return [
    `How do you see ${last} vs ${opp}?`,
    `Where does ${last} score from against ${opp}'s defence?`,
    `What's the best line on ${last}?`,
  ];
}
