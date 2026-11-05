/** Client-safe admin identity helpers (no server-only imports). */

export const DATA_ADMIN_EMAIL = 'admin@stattrackr.co';

/** Extra accounts that can use admin-gated surfaces (e.g. Betting Tools). */
const EXTRA_ADMIN_EMAILS = ['tristan.nikolovski31@gmail.com'] as const;

function publicAdminEmails(): Set<string> {
  const fromEnv = String(process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([DATA_ADMIN_EMAIL, ...EXTRA_ADMIN_EMAILS, ...fromEnv]);
}

export function isDataAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return publicAdminEmails().has(normalized);
}
