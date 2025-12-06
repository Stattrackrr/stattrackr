-- Create table for storing historical betting odds
-- This prevents repeated API calls for the same data

CREATE TABLE IF NOT EXISTS historical_odds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT NOT NULL,
  stat_type TEXT NOT NULL CHECK (stat_type IN ('PTS', 'REB', 'AST', 'THREES', 'PRA', 'PR', 'PA', 'RA')),
  line DECIMAL(10,2) NOT NULL,
  over_odds TEXT,
  under_odds TEXT,
  bookmaker TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure we don't store duplicate odds for same player/game/stat/bookmaker
  UNIQUE(player_id, game_date, opponent, stat_type, bookmaker)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_historical_odds_player_date ON historical_odds(player_id, game_date);
CREATE INDEX IF NOT EXISTS idx_historical_odds_player_opponent ON historical_odds(player_id, opponent, game_date);
CREATE INDEX IF NOT EXISTS idx_historical_odds_stat_type ON historical_odds(stat_type, game_date);
CREATE INDEX IF NOT EXISTS idx_historical_odds_game_date ON historical_odds(game_date);

-- Add comment
COMMENT ON TABLE historical_odds IS 'Stores historical betting odds for players to avoid repeated API calls';

