-- Create table to store player stats vs each team
-- This allows instant similar player lookups without fetching game stats on-demand
-- Only keeps the most recent game per player/team combination

CREATE TABLE IF NOT EXISTS player_team_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  team_abbreviation TEXT NOT NULL, -- Opponent team
  game_date DATE NOT NULL,
  game_id INTEGER, -- BDL game ID
  
  -- Stats
  pts INTEGER DEFAULT 0,
  reb INTEGER DEFAULT 0,
  ast INTEGER DEFAULT 0,
  fg3m INTEGER DEFAULT 0,
  stl INTEGER DEFAULT 0,
  blk INTEGER DEFAULT 0,
  turnovers INTEGER DEFAULT 0, -- 'to' is a reserved keyword in PostgreSQL, using 'turnovers' instead
  fg_pct DECIMAL(5,3),
  fg3_pct DECIMAL(5,3),
  
  -- Minutes played
  min TEXT, -- e.g., "35:42"
  min_decimal DECIMAL(5,2), -- e.g., 35.7 (for easy comparison)
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure only one record per player/team (most recent game)
  UNIQUE(player_id, team_abbreviation)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_player_team_stats_player ON player_team_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_player_team_stats_team ON player_team_stats(team_abbreviation);
CREATE INDEX IF NOT EXISTS idx_player_team_stats_date ON player_team_stats(game_date DESC);
CREATE INDEX IF NOT EXISTS idx_player_team_stats_combo ON player_team_stats(player_id, team_abbreviation, game_date DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_player_team_stats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_player_team_stats_updated_at_trigger ON player_team_stats;
CREATE TRIGGER update_player_team_stats_updated_at_trigger
  BEFORE UPDATE ON player_team_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_player_team_stats_updated_at();

-- Enable RLS (but allow public read access)
ALTER TABLE player_team_stats ENABLE ROW LEVEL SECURITY;

-- Allow public read access (no auth required for similar players feature)
DROP POLICY IF EXISTS "Public read access" ON player_team_stats;
CREATE POLICY "Public read access" ON player_team_stats
  FOR SELECT
  USING (true);

-- Only service role can insert/update/delete
DROP POLICY IF EXISTS "Service role full access" ON player_team_stats;
CREATE POLICY "Service role full access" ON player_team_stats
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE player_team_stats IS 'Stores player stats vs each team (most recent game only). Used for instant similar player lookups.';

