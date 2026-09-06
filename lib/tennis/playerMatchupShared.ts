export const TENNIS_MATCHUP_STATS = [
  {
    key: 'gamesWon',
    playerKey: 'gamesWon',
    opponentKey: 'gamesLost',
    label: 'Games Won',
    playerSideLabel: 'Wins',
    opponentSideLabel: 'Allows',
    pct: false,
    playerInvert: false,
    opponentInvert: true,
  },
  {
    key: 'gamesLost',
    playerKey: 'gamesLost',
    opponentKey: 'gamesWon',
    label: 'Games Lost',
    playerSideLabel: 'Lost',
    opponentSideLabel: 'Wins',
    pct: false,
    playerInvert: true,
    opponentInvert: false,
  },
  {
    key: 'aces',
    playerKey: 'aces',
    opponentKey: 'opponentAces',
    label: 'Aces',
    playerSideLabel: 'Aces',
    opponentSideLabel: 'Allows',
    pct: false,
    playerInvert: false,
    opponentInvert: true,
  },
  {
    key: 'opponentAces',
    playerKey: 'opponentAces',
    opponentKey: 'aces',
    label: 'Opp Aces',
    playerSideLabel: 'Faces',
    opponentSideLabel: 'Aces',
    pct: false,
    playerInvert: true,
    opponentInvert: false,
  },
  {
    key: 'setsWon',
    playerKey: 'setsWon',
    opponentKey: 'setsLost',
    label: 'Sets Won',
    playerSideLabel: 'Wins',
    opponentSideLabel: 'Allows',
    pct: false,
    playerInvert: false,
    opponentInvert: true,
  },
  {
    key: 'setsLost',
    playerKey: 'setsLost',
    opponentKey: 'setsWon',
    label: 'Sets Lost',
    playerSideLabel: 'Lost',
    opponentSideLabel: 'Wins',
    pct: false,
    playerInvert: true,
    opponentInvert: false,
  },
  {
    key: 'servicePointsWonPct',
    playerKey: 'servicePointsWonPct',
    opponentKey: 'returnPointsWonPct',
    label: 'Serve %',
    playerSideLabel: 'Serve',
    opponentSideLabel: 'Return',
    pct: true,
    playerInvert: false,
    opponentInvert: false,
  },
  {
    key: 'returnPointsWonPct',
    playerKey: 'returnPointsWonPct',
    opponentKey: 'servicePointsWonPct',
    label: 'Return %',
    playerSideLabel: 'Return',
    opponentSideLabel: 'Serve',
    pct: true,
    playerInvert: false,
    opponentInvert: false,
  },
] as const;

export type TennisMatchupStatKey = (typeof TENNIS_MATCHUP_STATS)[number]['playerKey'];

export type TennisMatchupSide = {
  id: string | null;
  name: string;
  ioc: string | null;
  matches: number;
  totalMatches: number;
};

export type TennisMatchupRow = {
  key: (typeof TENNIS_MATCHUP_STATS)[number]['key'];
  label: string;
  playerSideLabel: string;
  opponentSideLabel: string;
  pct: boolean;
  playerValue: number | null;
  playerRank: number | null;
  opponentValue: number | null;
  opponentRank: number | null;
};

export type TennisMatchupBestOf = 3 | 5;

export type TennisPlayerMatchupPayload = {
  tour: 'ATP' | 'WTA';
  year: number;
  window: number;
  bestOf: TennisMatchupBestOf;
  fieldSize: number;
  player: TennisMatchupSide;
  opponent: TennisMatchupSide;
  rows: TennisMatchupRow[];
};
