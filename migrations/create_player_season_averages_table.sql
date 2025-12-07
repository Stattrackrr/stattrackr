-- Create table to store player season averages for instant lookups
CREATE TABLE IF NOT EXISTS player_season_averages (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  
  -- Basic stats
  games_played INTEGER DEFAULT 0,
  pts DECIMAL(5,2) DEFAULT 0,
  reb DECIMAL(5,2) DEFAULT 0,
  ast DECIMAL(5,2) DEFAULT 0,
  fg3m DECIMAL(5,2) DEFAULT 0,
  stl DECIMAL(5,2) DEFAULT 0,
  blk DECIMAL(5,2) DEFAULT 0,
  turnovers DECIMAL(5,2) DEFAULT 0,
  fg_pct DECIMAL(5,3),
  fg3_pct DECIMAL(5,3),
  ft_pct DECIMAL(5,3),
  min DECIMAL(5,2),
  
  -- Calculated combo stats
  pra DECIMAL(6,2) DEFAULT 0, -- Points + Rebounds + Assists
  pr DECIMAL(6,2) DEFAULT 0,   -- Points + Rebounds
  pa DECIMAL(6,2) DEFAULT 0,  -- Points + Assists
  ra DECIMAL(6,2) DEFAULT 0,  -- Rebounds + Assists
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one record per player per season
  UNIQUE(player_id, season)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_player_season_avg_player_id ON player_season_averages(player_id);
CREATE INDEX IF NOT EXISTS idx_player_season_avg_season ON player_season_averages(season);
CREATE INDEX IF NOT EXISTS idx_player_season_avg_player_season ON player_season_averages(player_id, season);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_player_season_averages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_player_season_averages_updated_at
  BEFORE UPDATE ON player_season_averages
  FOR EACH ROW
  EXECUTE FUNCTION update_player_season_averages_updated_at();

-- Enable RLS (Row Level Security)
ALTER TABLE player_season_averages ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to all authenticated users
CREATE POLICY "Allow read access to player season averages"
  ON player_season_averages
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow service role to do everything
CREATE POLICY "Allow service role full access to player season averages"
  ON player_season_averages
  FOR ALL
  TO service_role
  USING (true);

COMMENT ON TABLE player_season_averages IS 'Caches player season averages for all stats to enable instant lookups without API calls';


