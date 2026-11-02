/** Options for the props-page "We want your say" survey (shared by the popup and the API). */
export const NEXT_PROJECT_OPTIONS = [
  {
    id: 'another_sport',
    label: 'Another sport',
    detail: 'Tell us which one you want covered next.',
    points: [] as string[],
  },
  {
    id: 'betting_tools',
    label: 'A new betting tools board',
    detail: 'One board with:',
    points: [
      'Bonus bet flipper: the best bets to turn bonus bets into cash',
      'Arbitrage: both sides at different bookies for a locked-in profit',
      'Middles: lines that differ between bookies, so both bets can win',
      'EV: prices above fair value, ranked by expected value',
    ],
  },
] as const;

export type NextProjectOption = (typeof NEXT_PROJECT_OPTIONS)[number]['id'];
