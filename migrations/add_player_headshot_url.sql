-- Add headshot_url column to players table for ESPN player photos
ALTER TABLE players 
  ADD COLUMN IF NOT EXISTS headshot_url TEXT;

CREATE INDEX IF NOT EXISTS idx_players_headshot_url ON players(headshot_url) WHERE headshot_url IS NOT NULL;

COMMENT ON COLUMN players.headshot_url IS 'ESPN player headshot URL, fetched from roster API and matched by name';

