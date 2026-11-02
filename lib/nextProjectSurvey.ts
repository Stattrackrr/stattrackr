/** Options for the props-page "We want your say" survey (shared by the popup and the API). */
export const NEXT_PROJECT_OPTIONS = [
  { id: 'another_sport', label: 'Another sport', detail: 'Tell us which one you want covered next.' },
  { id: 'bonus_flipper', label: 'Bonus bet flipper', detail: 'The best bets to turn bonus bets into cash, with the hedge worked out for you.' },
  { id: 'arbitrage', label: 'Arbitrage board', detail: 'Both sides at different bookies for a locked-in profit.' },
  { id: 'middles', label: 'Middles board', detail: 'Over/under lines that differ between bookies, so both bets can win.' },
  { id: 'ev_board', label: 'EV board', detail: 'Prices above fair value, ranked by expected value.' },
] as const;

export type NextProjectOption = (typeof NEXT_PROJECT_OPTIONS)[number]['id'];
