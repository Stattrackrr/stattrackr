/** Client-safe admin identity helpers (no server-only imports). */

export const DATA_ADMIN_EMAIL = 'admin@stattrackr.co';

function publicAdminEmails(): Set<string> {
  const fromEnv = String(process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([DATA_ADMIN_EMAIL, ...fromEnv]);
}

export function isDataAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return publicAdminEmails().has(normalized);
}
