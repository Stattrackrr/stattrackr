-- NBA dashboard data, filled from BallDontLie (GOAT) by the NBA sync workflow.
-- Writes come only from the server / workflow (service role bypasses RLS).
-- RLS is on with no policies, so the tables are read through our API routes only.

-- ---------------------------------------------------------------------------
-- Teams (the 30 current franchises)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_teams (
  id INTEGER PRIMARY KEY,                    -- BDL team id
  abbreviation TEXT NOT NULL,
  full_name TEXT NOT NULL,
  city TEXT,
  name TEXT,
  conference TEXT,
  division TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nba_teams_abbr ON public.nba_teams (abbreviation);

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_players (
  id BIGINT PRIMARY KEY,                     -- BDL player id
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  position TEXT,
  height TEXT,
  weight TEXT,
  jersey_number TEXT,
  college TEXT,
  country TEXT,
  draft_year INTEGER,
  draft_round INTEGER,
  draft_number INTEGER,
  team_id INTEGER,                           -- current team (null = free agent)
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  nba_person_id BIGINT,                      -- NBA.com id, for headshots
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nba_players_team ON public.nba_players (team_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_nba_players_name ON public.nba_players (lower(full_name));

-- ---------------------------------------------------------------------------
-- Games (schedule + results, with quarter scores)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_games (
  id BIGINT PRIMARY KEY,                     -- BDL game id
  season INTEGER NOT NULL,                   -- season start year (2025 = 2025-26)
  game_date DATE NOT NULL,
  tipoff_at TIMESTAMPTZ,
  status TEXT,
  status_state TEXT,                         -- scheduled | in_progress | final
  period SMALLINT,
  postseason BOOLEAN NOT NULL DEFAULT FALSE,
  postponed BOOLEAN NOT NULL DEFAULT FALSE,
  ist_stage TEXT,
  home_team_id INTEGER NOT NULL,
  visitor_team_id INTEGER NOT NULL,
  home_score INTEGER,
  visitor_score INTEGER,
  home_q1 SMALLINT, home_q2 SMALLINT, home_q3 SMALLINT, home_q4 SMALLINT,
  home_ot1 SMALLINT, home_ot2 SMALLINT, home_ot3 SMALLINT,
  visitor_q1 SMALLINT, visitor_q2 SMALLINT, visitor_q3 SMALLINT, visitor_q4 SMALLINT,
  visitor_ot1 SMALLINT, visitor_ot2 SMALLINT, visitor_ot3 SMALLINT,
  plays_synced_at TIMESTAMPTZ,               -- set once play-by-play + shots are stored
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nba_games_season_date ON public.nba_games (season, game_date);
CREATE INDEX IF NOT EXISTS idx_nba_games_date ON public.nba_games (game_date);
CREATE INDEX IF NOT EXISTS idx_nba_games_home ON public.nba_games (home_team_id, game_date);
CREATE INDEX IF NOT EXISTS idx_nba_games_visitor ON public.nba_games (visitor_team_id, game_date);

-- ---------------------------------------------------------------------------
-- Player box scores. period 0 = full game, 1-4 = quarters.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_player_game_stats (
  game_id BIGINT NOT NULL,
  player_id BIGINT NOT NULL,
  period SMALLINT NOT NULL DEFAULT 0,
  season INTEGER NOT NULL,
  game_date DATE NOT NULL,
  postseason BOOLEAN NOT NULL DEFAULT FALSE,
  team_id INTEGER NOT NULL,
  opponent_team_id INTEGER NOT NULL,
  is_home BOOLEAN NOT NULL,
  minutes NUMERIC(5, 2),
  pts SMALLINT, reb SMALLINT, oreb SMALLINT, dreb SMALLINT, ast SMALLINT,
  stl SMALLINT, blk SMALLINT, turnover SMALLINT, pf SMALLINT,
  fgm SMALLINT, fga SMALLINT, fg3m SMALLINT, fg3a SMALLINT, ftm SMALLINT, fta SMALLINT,
  plus_minus SMALLINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, player_id, period)
);

CREATE INDEX IF NOT EXISTS idx_nba_pgs_player ON public.nba_player_game_stats (player_id, period, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_nba_pgs_team ON public.nba_player_game_stats (team_id, season, period);
CREATE INDEX IF NOT EXISTS idx_nba_pgs_opponent ON public.nba_player_game_stats (opponent_team_id, season, period);

-- ---------------------------------------------------------------------------
-- Player advanced + tracking per game (full game only).
-- The columns the dashboard charts use are typed; the full BDL row is kept in raw.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_player_game_advanced (
  game_id BIGINT NOT NULL,
  player_id BIGINT NOT NULL,
  season INTEGER NOT NULL,
  game_date DATE NOT NULL,
  team_id INTEGER NOT NULL,
  opponent_team_id INTEGER NOT NULL,
  usage_pct NUMERIC(6, 4),
  ts_pct NUMERIC(6, 4),
  efg_pct NUMERIC(6, 4),
  pace NUMERIC(7, 2),
  possessions NUMERIC(7, 2),
  offensive_rating NUMERIC(7, 2),
  defensive_rating NUMERIC(7, 2),
  net_rating NUMERIC(7, 2),
  pie NUMERIC(6, 4),
  touches SMALLINT,
  passes SMALLINT,
  secondary_assists SMALLINT,
  free_throw_assists SMALLINT,
  rebound_chances_total SMALLINT,            -- potential rebounds
  rebound_chances_off SMALLINT,
  rebound_chances_def SMALLINT,
  contested_fga SMALLINT,
  uncontested_fga SMALLINT,
  deflections SMALLINT,
  screen_assists SMALLINT,
  points_paint SMALLINT,
  points_fast_break SMALLINT,
  points_second_chance SMALLINT,
  points_off_turnovers SMALLINT,
  distance NUMERIC(6, 2),
  speed NUMERIC(6, 2),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_nba_pga_player ON public.nba_player_game_advanced (player_id, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_nba_pga_opponent ON public.nba_player_game_advanced (opponent_team_id, season);

-- ---------------------------------------------------------------------------
-- Play-by-play (2025-26 season onward). participants = [primary, secondary, ...].
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_plays (
  game_id BIGINT NOT NULL,
  play_order INTEGER NOT NULL,
  season INTEGER NOT NULL,
  period SMALLINT,
  clock TEXT,
  type TEXT,
  text TEXT,
  team_id INTEGER,
  participants BIGINT[],
  scoring_play BOOLEAN,
  shooting_play BOOLEAN,
  score_value SMALLINT,
  home_score SMALLINT,
  away_score SMALLINT,
  coordinate_x NUMERIC(5, 1),
  coordinate_y NUMERIC(5, 1),
  wallclock TIMESTAMPTZ,
  PRIMARY KEY (game_id, play_order)
);

-- ---------------------------------------------------------------------------
-- Field-goal attempts, derived from nba_plays (free throws excluded).
-- Coordinates are feet on a half court: x 0-50 sideline to sideline, y from the baseline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_shots (
  game_id BIGINT NOT NULL,
  play_order INTEGER NOT NULL,
  season INTEGER NOT NULL,
  game_date DATE NOT NULL,
  team_id INTEGER NOT NULL,
  opponent_team_id INTEGER NOT NULL,
  shooter_id BIGINT NOT NULL,
  assister_id BIGINT,
  period SMALLINT,
  clock TEXT,
  shot_type TEXT,
  made BOOLEAN NOT NULL,
  is_three BOOLEAN NOT NULL,
  x NUMERIC(5, 1),
  y NUMERIC(5, 1),
  distance_ft NUMERIC(5, 1),
  zone TEXT,                                 -- restricted | paint | mid_range | left_corner_3 | right_corner_3 | above_break_3 | backcourt
  PRIMARY KEY (game_id, play_order)
);

CREATE INDEX IF NOT EXISTS idx_nba_shots_shooter ON public.nba_shots (shooter_id, season);
CREATE INDEX IF NOT EXISTS idx_nba_shots_assister ON public.nba_shots (assister_id, season) WHERE assister_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nba_shots_opponent ON public.nba_shots (opponent_team_id, season);
CREATE INDEX IF NOT EXISTS idx_nba_shots_team ON public.nba_shots (team_id, season);

-- ---------------------------------------------------------------------------
-- Starting lineups / bench per game
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_lineups (
  game_id BIGINT NOT NULL,
  player_id BIGINT NOT NULL,
  team_id INTEGER NOT NULL,
  starter BOOLEAN NOT NULL DEFAULT FALSE,
  position TEXT,
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_nba_lineups_team ON public.nba_lineups (team_id, game_id);

-- ---------------------------------------------------------------------------
-- Current injury report (replaced on every sync)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_injuries (
  player_id BIGINT PRIMARY KEY,
  team_id INTEGER,
  status TEXT,
  return_date TEXT,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nba_injuries_team ON public.nba_injuries (team_id);

-- ---------------------------------------------------------------------------
-- Standings (ladder)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_standings (
  season INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  wins SMALLINT,
  losses SMALLINT,
  conference_rank SMALLINT,
  division_rank SMALLINT,
  conference_record TEXT,
  division_record TEXT,
  home_record TEXT,
  road_record TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, team_id)
);

-- ---------------------------------------------------------------------------
-- Season averages: every BDL category/type (general/base, tracking/passing,
-- tracking/rebounding, shooting/by_zone, playtype/isolation, ...) as JSON.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_player_season_averages (
  season INTEGER NOT NULL,
  season_type TEXT NOT NULL,                 -- regular | playoffs
  category TEXT NOT NULL,
  stat_type TEXT NOT NULL,
  player_id BIGINT NOT NULL,
  stats JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, season_type, category, stat_type, player_id)
);

CREATE INDEX IF NOT EXISTS idx_nba_psa_player ON public.nba_player_season_averages (player_id, season);

CREATE TABLE IF NOT EXISTS public.nba_team_season_averages (
  season INTEGER NOT NULL,
  season_type TEXT NOT NULL,
  category TEXT NOT NULL,
  stat_type TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  stats JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, season_type, category, stat_type, team_id)
);

-- ---------------------------------------------------------------------------
-- Sync bookkeeping (cursors, last run per job)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nba_sync_state (
  job TEXT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- RLS: on, no policies (service role only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.nba_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_player_game_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_player_game_advanced ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_injuries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_player_season_averages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_team_season_averages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_sync_state ENABLE ROW LEVEL SECURITY;
