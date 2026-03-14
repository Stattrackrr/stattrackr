import { getAflCanonicalTeamKeyLower } from './aflTeamCanonical';

/**
 * AFL team primary brand colors (hex) for lineup badges and legend.
 * Keys are lowercase canonical keys (same as aflTeamCanonical).
 */
const TEAM_COLORS: Record<string, string> = {
  adelaide: '#002B5C',       // Crows navy
  brisbane: '#A30044',       // Lions maroon
  carlton: '#011F3C',        // Blues navy
  collingwood: '#000000',    // Magpies black
  essendon: '#CC0000',       // Bombers red
  fremantle: '#6B2D5C',      // Dockers purple
  geelong: '#0E4C92',        // Cats blue
  'gold coast': '#E31837',   // Suns red
  gws: '#F47920',            // Giants orange
  hawthorn: '#4D2004',       // Hawks brown
  melbourne: '#0D0D0D',      // Demons navy/black
  'north melbourne': '#003A70', // Kangaroos blue
  'port adelaide': '#00B4B4',   // Power teal
  richmond: '#FFD100',       // Tigers yellow (primary)
  'st kilda': '#E31837',     // Saints red
  sydney: '#E31837',        // Swans red
  'west coast': '#002A5B',  // Eagles blue
  'western bulldogs': '#E31837', // Bulldogs red
};

/** Lighten a hex color toward white for a brighter on-screen look (blend ~70% original + 30% white). */
function brighten(hex: string, amount = 0.28): string {
  const h = hex.replace(/^#/, '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/** Return primary brand color (hex) for an AFL team name, brightened for UI. Uses shared canonical keys. Fallback for unknown. */
export function getAflTeamColor(team: string | null | undefined): string {
  const key = getAflCanonicalTeamKeyLower(team);
  const base = key ? (TEAM_COLORS[key] ?? '#64748b') : '#64748b';
  return brighten(base);
}

/** Return '#000' or '#fff' for readable text on the given hex background. */
export function getAflTeamBadgeTextColor(hex: string): string {
  const h = hex.replace(/^#/, '');
  if (h.length !== 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? '#000' : '#fff';
}
