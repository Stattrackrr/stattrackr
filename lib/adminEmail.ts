/** Client-safe admin identity helpers (no server-only imports). */

export const DATA_ADMIN_EMAIL = 'admin@stattrackr.co';

export function isDataAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === DATA_ADMIN_EMAIL;
}
