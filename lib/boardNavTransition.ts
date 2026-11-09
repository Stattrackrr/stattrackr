/**
 * Props ↔ Tools board handoff — mark direction, navigate immediately.
 * Enter polish lives on BoardPageShell (no leave wait — that felt cheap/laggy).
 */

export type BoardNavDir = 'to-tools' | 'to-props';

const DIR_KEY = 'stattrackr_board_nav_dir';

export function markBoardNavDir(dir: BoardNavDir): void {
  try {
    sessionStorage.setItem(DIR_KEY, dir);
  } catch {
    /* ignore */
  }
}

export function consumeBoardNavDir(): BoardNavDir | null {
  try {
    const value = sessionStorage.getItem(DIR_KEY);
    sessionStorage.removeItem(DIR_KEY);
    if (value === 'to-tools' || value === 'to-props') return value;
  } catch {
    /* ignore */
  }
  return null;
}

/** Instant push with a direction marker for the destination enter. */
export function pushBoardRoute(
  push: (href: string) => void,
  href: string,
  dir: BoardNavDir,
): void {
  markBoardNavDir(dir);
  push(href);
}
