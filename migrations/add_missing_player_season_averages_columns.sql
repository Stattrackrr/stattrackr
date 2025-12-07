-- Add missing columns to player_season_averages table
-- These columns are needed for complete stat tracking

-- Add field goal columns
ALTER TABLE player_season_averages 
  ADD COLUMN IF NOT EXISTS fgm DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fga DECIMAL(5,2) DEFAULT 0;

-- Add three-point attempt column (fg3m already exists)
ALTER TABLE player_season_averages 
  ADD COLUMN IF NOT EXISTS fg3a DECIMAL(5,2) DEFAULT 0;

-- Add free throw columns
ALTER TABLE player_season_averages 
  ADD COLUMN IF NOT EXISTS ftm DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fta DECIMAL(5,2) DEFAULT 0;

-- Add turnover column (table has 'turnovers', but sync uses 'turnover')
-- We'll add 'turnover' and keep 'turnovers' for backward compatibility
ALTER TABLE player_season_averages 
  ADD COLUMN IF NOT EXISTS turnover DECIMAL(5,2) DEFAULT 0;

-- Add personal fouls column
ALTER TABLE player_season_averages 
  ADD COLUMN IF NOT EXISTS pf DECIMAL(5,2) DEFAULT 0;

-- Update comment
COMMENT ON COLUMN player_season_averages.fgm IS 'Field goals made per game average';
COMMENT ON COLUMN player_season_averages.fga IS 'Field goal attempts per game average';
COMMENT ON COLUMN player_season_averages.fg3a IS 'Three-point attempts per game average';
COMMENT ON COLUMN player_season_averages.ftm IS 'Free throws made per game average';
COMMENT ON COLUMN player_season_averages.fta IS 'Free throw attempts per game average';
COMMENT ON COLUMN player_season_averages.turnover IS 'Turnovers per game average (synonym for turnovers)';
COMMENT ON COLUMN player_season_averages.pf IS 'Personal fouls per game average';


