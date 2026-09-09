export const PLAYER_FORM_WINDOWS = [5, 10, 15, 20] as const;
export type PlayerFormWindow = (typeof PLAYER_FORM_WINDOWS)[number];

export const PLAYER_FORM_SPLIT_WINDOW = 30;

export type PlayerFormTone = 'good' | 'ok' | 'bad' | 'neutral';

export type PlayerFormStatBlock = {
  matches: number;
  wins: number;
  losses: number;
  winPct: number | null;
  aces: number | null;
  totalGames: number | null;
  holdPct: number | null;
  rpw: number | null;
  over215: number | null;
  over225: number | null;
};

export type PlayerFormRankBand = PlayerFormStatBlock & {
  id: string;
  label: string;
};

export type PlayerFormStyleSplit = PlayerFormStatBlock & {
  id: string;
  label: string;
  hint: string;
};

export type PlayerFormInsight = {
  id: string;
  title: string;
  body: string;
  tone: PlayerFormTone;
  pinned?: boolean;
};

export type PlayerFormRecentMatch = {
  matchId: string;
  date: string | null;
  opponent: string;
  opponentIoc: string | null;
  opponentRank: number | null;
  surface: string | null;
  tourneyName: string | null;
  round: string | null;
  score: string;
  isWin: boolean;
  aces: number | null;
  totalGames: number | null;
  tour: 'ATP' | 'WTA';
  isGrandSlam: boolean;
};

export type PlayerFormOpponentNote = {
  name: string;
  rank: number | null;
  rpw: number | null;
  firstServePct: number | null;
  aces: number | null;
  returnLabel: 'weak' | 'average' | 'strong' | null;
  serveLabel: 'weak' | 'average' | 'strong' | null;
  surface: string | null;
};

export type TennisPlayerFormPayload = {
  tour: 'ATP' | 'WTA';
  player: { id: string | null; name: string };
  splitWindow: number;
  baseline: PlayerFormStatBlock;
  rankBands: PlayerFormRankBand[];
  styleSplits: PlayerFormStyleSplit[];
  insights: PlayerFormInsight[];
  opponent: PlayerFormOpponentNote | null;
  recent: PlayerFormRecentMatch[];
};
