-- Add offensive and defensive rebound columns to player_season_averages table
-- These are needed for the new stat types in similar players feature

ALTER TABLE player_season_averages 
  ADD COLUMN IF NOT EXISTS oreb DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dreb DECIMAL(5,2) DEFAULT 0;

-- Update comment
COMMENT ON COLUMN player_season_averages.oreb IS 'Offensive rebounds per game average';
COMMENT ON COLUMN player_season_averages.dreb IS 'Defensive rebounds per game average';

