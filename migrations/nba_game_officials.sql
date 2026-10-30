-- Referee crews per NBA game (feature library: referee tendencies). Tonight's crews come from the
-- NBA's daily assignments (posted ~9am ET); finished games are filled from ESPN, which replaces the
-- assignment with the crew that actually worked. Snapshots store the crew's numbers as they stood at
-- capture time, so later corrections here never leak into logged features.

CREATE TABLE IF NOT EXISTS public.nba_game_officials (
  game_id TEXT PRIMARY KEY,
  game_date DATE NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  officials TEXT[] NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('nba_assignments', 'espn')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nba_game_officials_date_idx ON public.nba_game_officials (game_date);

ALTER TABLE public.nba_game_officials ENABLE ROW LEVEL SECURITY;
