-- Create players table to cache all active NBA players
-- This allows instant lookups without calling BDL API every time

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY, -- BDL player ID
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  position TEXT, -- G, F, C, G-F, F-C, etc.
  height TEXT, -- e.g., "6-10", "77" (inches) - original format
  height_inches INTEGER, -- Height in inches for fast filtering (e.g., 82 for 6'10")
  weight INTEGER, -- in pounds
  team_id INTEGER, -- BDL team ID
  team_abbreviation TEXT, -- e.g., "LAL", "GSW"
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_players_team_abbr ON players(team_abbreviation);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
CREATE INDEX IF NOT EXISTS idx_players_height_inches ON players(height_inches);
CREATE INDEX IF NOT EXISTS idx_players_updated_at ON players(updated_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_players_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_players_updated_at_trigger ON players;
CREATE TRIGGER update_players_updated_at_trigger
  BEFORE UPDATE ON players
  FOR EACH ROW
  EXECUTE FUNCTION update_players_updated_at();

-- Enable RLS (but allow public read access for similar players feature)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Allow public read access (no auth required for player lookups)
DROP POLICY IF EXISTS "Public read access" ON players;
CREATE POLICY "Public read access" ON players
  FOR SELECT
  USING (true);

-- Only service role can insert/update/delete
DROP POLICY IF EXISTS "Service role full access" ON players;
CREATE POLICY "Service role full access" ON players
  FOR ALL
  USING (auth.role() = 'service_role');

