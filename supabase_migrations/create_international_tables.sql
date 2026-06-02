-- International football tables (StatsBomb open data + BDL World Cup join)
-- Source: https://github.com/statsbomb/open-data
--
-- Naming: prefix `international_` so the same schema can hold Euros, World Cups,
-- Copa America etc. without colliding with `soccer_*` (club) tables.

CREATE TABLE IF NOT EXISTS international_competitions (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                  -- 'statsbomb' | 'bdl'
  competition_id TEXT NOT NULL,          -- StatsBomb competition_id (e.g. '55' for UEFA Euro)
  competition_name TEXT NOT NULL,        -- 'UEFA Euro'
  season_id TEXT NOT NULL,               -- StatsBomb season_id (e.g. '43' for Euro 2020)
  season_year INTEGER NOT NULL,          -- 2020, 2024
  tournament_slug TEXT NOT NULL,         -- 'euros' | 'worldcup'
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, competition_id, season_id)
);

CREATE TABLE IF NOT EXISTS international_teams (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  country_code TEXT,                     -- ISO 3166-1 alpha-3 if known
  bdl_team_id BIGINT,                    -- mapped to BDL teams.id when matched
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_team_id)
);

CREATE TABLE IF NOT EXISTS international_matches (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_match_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  tournament_slug TEXT NOT NULL,         -- 'euros' | 'worldcup'
  season_year INTEGER NOT NULL,
  match_date DATE,
  kickoff_unix BIGINT,
  stage TEXT,                            -- 'group_stage', 'round_of_16', etc.
  home_team_source_id TEXT NOT NULL,
  away_team_source_id TEXT NOT NULL,
  home_team_name TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  status TEXT NOT NULL DEFAULT 'completed',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_match_id)
);

CREATE TABLE IF NOT EXISTS international_players (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_player_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,         -- lowercased, accents stripped
  country_code TEXT,
  primary_position TEXT,                 -- inferred from most common position
  bdl_player_id BIGINT,                  -- mapped when matched, NULL when unmatched
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_player_id)
);

CREATE TABLE IF NOT EXISTS international_player_match_stats (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_match_id TEXT NOT NULL,
  source_player_id TEXT NOT NULL,
  source_team_id TEXT NOT NULL,
  is_home BOOLEAN NOT NULL,
  position TEXT,
  minutes_played INTEGER,
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  shots_total INTEGER NOT NULL DEFAULT 0,
  shots_on_target INTEGER NOT NULL DEFAULT 0,
  passes_total INTEGER NOT NULL DEFAULT 0,
  passes_accurate INTEGER NOT NULL DEFAULT 0,
  expected_goals NUMERIC(6, 3),
  yellow_cards INTEGER NOT NULL DEFAULT 0,
  red_cards INTEGER NOT NULL DEFAULT 0,
  tackles INTEGER NOT NULL DEFAULT 0,
  interceptions INTEGER NOT NULL DEFAULT 0,
  fouls INTEGER NOT NULL DEFAULT 0,
  was_fouled INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  big_chances_created INTEGER NOT NULL DEFAULT 0,
  raw_aggregates JSONB,                  -- full event counts for future extension
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_match_id, source_player_id)
);

CREATE TABLE IF NOT EXISTS international_player_warnings (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_player_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  team_name TEXT,
  reason TEXT NOT NULL,                  -- 'no_bdl_match' | 'multiple_bdl_matches'
  bdl_candidates JSONB,                  -- list of plausible BDL players
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot-path indexes
CREATE INDEX IF NOT EXISTS idx_intl_matches_tournament ON international_matches(tournament_slug, season_year);
CREATE INDEX IF NOT EXISTS idx_intl_matches_kickoff ON international_matches(kickoff_unix DESC);
CREATE INDEX IF NOT EXISTS idx_intl_matches_teams ON international_matches(home_team_source_id, away_team_source_id);
CREATE INDEX IF NOT EXISTS idx_intl_player_stats_match ON international_player_match_stats(source_match_id);
CREATE INDEX IF NOT EXISTS idx_intl_player_stats_player ON international_player_match_stats(source_player_id);
CREATE INDEX IF NOT EXISTS idx_intl_player_stats_team ON international_player_match_stats(source_team_id);
CREATE INDEX IF NOT EXISTS idx_intl_players_normalized ON international_players(normalized_name);
CREATE INDEX IF NOT EXISTS idx_intl_players_bdl ON international_players(bdl_player_id);
CREATE INDEX IF NOT EXISTS idx_intl_teams_bdl ON international_teams(bdl_team_id);

COMMENT ON TABLE international_competitions IS 'Registry of tournaments ingested (Euros/WC).';
COMMENT ON TABLE international_matches IS 'StatsBomb-sourced international matches; complements BDL World Cup data.';
COMMENT ON TABLE international_player_match_stats IS 'Per-player-per-match aggregates derived from StatsBomb event data.';
COMMENT ON TABLE international_player_warnings IS 'Players that could not be uniquely matched to a BDL row; review and update international_players.bdl_player_id manually.';
