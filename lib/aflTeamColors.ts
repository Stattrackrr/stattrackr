import { getAflCanonicalTeamKeyLower } from './aflTeamCanonical';

/**
 * AFL team primary brand colors (hex) for lineup badges and legend.
 * Keys are lowercase canonical keys (same as aflTeamCanonical).
 */
const TEAM_COLORS: Record<string, string> = {
  adelaide: '#B35A00',       // Crows dark orange
  brisbane: '#A30044',       // Lions maroon
  carlton: '#011F3C',        // Blues navy
  collingwood: '#000000',    // Magpies black
  essendon: '#CC0000',       // Bombers red
  fremantle: '#6B2D5C',      // Dockers purple
  geelong: '#0E4C92',        // Cats blue
  'gold coast': '#E31837',   // Suns red
  gws: '#F47920',            // Giants orange
  hawthorn: '#4D2004',       // Hawks brown
  melbourne: '#0A1026',      // Demons very dark navy
  'north melbourne': '#5DA9E9', // Kangaroos light blue
  'port adelaide': '#00B4B4',   // Power teal
  richmond: '#FFD100',       // Tigers yellow (primary)
  'st kilda': '#8B0000',     // Saints dark red
  sydney: '#FF6B6B',         // Swans light red
  'west coast': '#B8860B',   // Eagles dark yellow
  'western bulldogs': '#0B3D91', // Bulldogs dark blue
};

/** Lighten a hex color slightly for UI readability while preserving chosen team shades. */
function brighten(hex: string, amount = 0.12): string {
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
