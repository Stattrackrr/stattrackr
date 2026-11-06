/** Client-safe admin identity helpers (no server-only imports). */

export const DATA_ADMIN_EMAIL = 'admin@stattrackr.co';

/** Betting Tools only — not full site admin / AI picks admin. */
const TOOLS_ADMIN_EMAILS = [
  DATA_ADMIN_EMAIL,
  'tristan.nikolovski31@gmail.com',
] as const;

function publicAdminEmails(): Set<string> {
  const fromEnv = String(process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([DATA_ADMIN_EMAIL, ...fromEnv]);
}

function toolsAdminEmails(): Set<string> {
  const fromEnv = String(process.env.NEXT_PUBLIC_TOOLS_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...TOOLS_ADMIN_EMAILS, ...fromEnv]);
}

/** Full admin (AI picks, data, etc.) — primary account only (+ optional env). */
export function isDataAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return publicAdminEmails().has(normalized);
}

/** Tools admin bypass (inbox + Pro gate). Pro subscribers also get Tools. */
export function isToolsAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return toolsAdminEmails().has(normalized);
}
