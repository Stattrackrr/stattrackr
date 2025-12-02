-- Add parlay_legs JSONB column to store structured parlay leg data
-- This allows direct lookup of player stats instead of scanning all games

ALTER TABLE bets ADD COLUMN IF NOT EXISTS parlay_legs JSONB;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_bets_parlay_legs ON bets USING GIN (parlay_legs);

-- Add comment explaining the structure
COMMENT ON COLUMN bets.parlay_legs IS 'Structured parlay leg data: [{"playerId": "...", "playerName": "...", "team": "...", "opponent": "...", "gameDate": "...", "statType": "...", "line": 9.5, "overUnder": "over"}, ...]';

