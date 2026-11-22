/** Black Friday 2026 = Fri 27 Nov. Sale runs through 3 days after (Mon 30 Nov AU). */
export const BLACK_FRIDAY_SALE = {
  endsAt: new Date('2026-11-30T23:59:59+11:00'),
  endsLabel: '30 Nov 2026',
  /** Marketing "was" list prices (same 33% off as monthly $30 → $20). */
  was: { monthly: 30, semiannual: 150, annual: 270 },
  now: { monthly: 20, semiannual: 100, annual: 180 },
} as const;

export function isBlackFridaySaleActive(now = new Date()): boolean {
  return now.getTime() <= BLACK_FRIDAY_SALE.endsAt.getTime();
}
