/**
 * Shared helpers for dashboard betting-line inputs.
 * Never rewrite a focused input — parent sync was eating digits mid-keystroke.
 */

export const BETTING_LINE_INPUT_ID = 'betting-line-input';

export function isLineInputFocused(id: string = BETTING_LINE_INPUT_ID): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.getElementById(id);
  return Boolean(el && document.activeElement === el);
}

/** Write a committed value into the input only when the user is not typing in it. */
export function writeLineInputValue(
  value: number | string,
  id: string = BETTING_LINE_INPUT_ID,
  opts?: { force?: boolean }
): void {
  if (typeof document === 'undefined') return;
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) return;
  if (!opts?.force && document.activeElement === input) return;
  const next = String(value);
  if (input.value !== next) input.value = next;
}
