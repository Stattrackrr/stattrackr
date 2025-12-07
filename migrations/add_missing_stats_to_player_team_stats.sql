-- Add missing stat columns to player_team_stats table
-- These stats are needed for the similar players feature

ALTER TABLE player_team_stats
  ADD COLUMN IF NOT EXISTS fgm INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fga INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ftm INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fta INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oreb INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dreb INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pf INTEGER DEFAULT 0;

COMMENT ON COLUMN player_team_stats.fgm IS 'Field goals made';
COMMENT ON COLUMN player_team_stats.fga IS 'Field goals attempted';
COMMENT ON COLUMN player_team_stats.ftm IS 'Free throws made';
COMMENT ON COLUMN player_team_stats.fta IS 'Free throws attempted';
COMMENT ON COLUMN player_team_stats.oreb IS 'Offensive rebounds';
COMMENT ON COLUMN player_team_stats.dreb IS 'Defensive rebounds';
COMMENT ON COLUMN player_team_stats.pf IS 'Personal fouls';

