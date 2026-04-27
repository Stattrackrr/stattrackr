-- Permanent soccer data tables
-- Keeps soccer dashboard data as first-class records while preserving current API DTOs.

CREATE TABLE IF NOT EXISTS soccer_matches (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  summary_path TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_logo_url TEXT,
  away_logo_url TEXT,
  competition_name TEXT,
  competition_country TEXT,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  kickoff_unix BIGINT,
  source TEXT NOT NULL DEFAULT 'soccerway',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soccer_match_stats (
  match_id TEXT PRIMARY KEY REFERENCES soccer_matches(match_id) ON DELETE CASCADE,
  stats JSONB,
  source TEXT NOT NULL DEFAULT 'soccerway',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soccer_team_matches (
  team_href TEXT NOT NULL,
  match_id TEXT NOT NULL REFERENCES soccer_matches(match_id) ON DELETE CASCADE,
  kickoff_unix BIGINT,
  summary_path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'soccerway',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_href, match_id)
);

CREATE TABLE IF NOT EXISTS soccer_team_results_meta (
  team_href TEXT PRIMARY KEY,
  results_url TEXT NOT NULL,
  show_more_pages_fetched INTEGER NOT NULL DEFAULT 0,
  match_count INTEGER NOT NULL DEFAULT 0,
  history_probe_complete BOOLEAN NOT NULL DEFAULT TRUE,
  competition_metadata_version INTEGER,
  source TEXT NOT NULL DEFAULT 'soccerway',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soccer_team_next_fixtures (
  team_href TEXT PRIMARY KEY,
  fixtures_url TEXT NOT NULL,
  match_id TEXT,
  home_team TEXT,
  away_team TEXT,
  opponent_name TEXT,
  is_home BOOLEAN,
  team_logo_url TEXT,
  opponent_logo_url TEXT,
  kickoff_unix BIGINT,
  summary_path TEXT,
  competition_name TEXT,
  competition_country TEXT,
  competition_stage TEXT,
  match_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'soccerway',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soccer_team_predicted_lineups (
  team_href TEXT PRIMARY KEY,
  summary_path TEXT,
  lineups_path TEXT,
  event_id TEXT,
  lineup JSONB,
  source TEXT NOT NULL DEFAULT 'soccerway',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soccer_matches_kickoff_unix ON soccer_matches(kickoff_unix DESC);
CREATE INDEX IF NOT EXISTS idx_soccer_matches_competition ON soccer_matches(competition_country, competition_name);
CREATE INDEX IF NOT EXISTS idx_soccer_team_matches_team_href ON soccer_team_matches(team_href);
CREATE INDEX IF NOT EXISTS idx_soccer_team_matches_team_kickoff ON soccer_team_matches(team_href, kickoff_unix DESC);
CREATE INDEX IF NOT EXISTS idx_soccer_team_next_fixtures_kickoff ON soccer_team_next_fixtures(kickoff_unix);

CREATE OR REPLACE FUNCTION update_soccer_permanent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_soccer_matches_updated_at ON soccer_matches;
CREATE TRIGGER update_soccer_matches_updated_at
  BEFORE UPDATE ON soccer_matches
  FOR EACH ROW EXECUTE PROCEDURE update_soccer_permanent_updated_at();

DROP TRIGGER IF EXISTS update_soccer_match_stats_updated_at ON soccer_match_stats;
CREATE TRIGGER update_soccer_match_stats_updated_at
  BEFORE UPDATE ON soccer_match_stats
  FOR EACH ROW EXECUTE PROCEDURE update_soccer_permanent_updated_at();

DROP TRIGGER IF EXISTS update_soccer_team_matches_updated_at ON soccer_team_matches;
CREATE TRIGGER update_soccer_team_matches_updated_at
  BEFORE UPDATE ON soccer_team_matches
  FOR EACH ROW EXECUTE PROCEDURE update_soccer_permanent_updated_at();

DROP TRIGGER IF EXISTS update_soccer_team_results_meta_updated_at ON soccer_team_results_meta;
CREATE TRIGGER update_soccer_team_results_meta_updated_at
  BEFORE UPDATE ON soccer_team_results_meta
  FOR EACH ROW EXECUTE PROCEDURE update_soccer_permanent_updated_at();

DROP TRIGGER IF EXISTS update_soccer_team_next_fixtures_updated_at ON soccer_team_next_fixtures;
CREATE TRIGGER update_soccer_team_next_fixtures_updated_at
  BEFORE UPDATE ON soccer_team_next_fixtures
  FOR EACH ROW EXECUTE PROCEDURE update_soccer_permanent_updated_at();

DROP TRIGGER IF EXISTS update_soccer_team_predicted_lineups_updated_at ON soccer_team_predicted_lineups;
CREATE TRIGGER update_soccer_team_predicted_lineups_updated_at
  BEFORE UPDATE ON soccer_team_predicted_lineups
  FOR EACH ROW EXECUTE PROCEDURE update_soccer_permanent_updated_at();

COMMENT ON TABLE soccer_matches IS 'Permanent completed soccer matches used by the dashboard.';
COMMENT ON TABLE soccer_match_stats IS 'Permanent per-match stat payloads keyed by match_id.';
COMMENT ON TABLE soccer_team_matches IS 'Team-to-match index used to reconstruct dashboard histories by team href.';
COMMENT ON TABLE soccer_team_results_meta IS 'Team history metadata mirroring the current team-results route response.';
COMMENT ON TABLE soccer_team_next_fixtures IS 'Permanent upcoming fixture snapshot per team href.';
COMMENT ON TABLE soccer_team_predicted_lineups IS 'Permanent lineup snapshot per team href.';
