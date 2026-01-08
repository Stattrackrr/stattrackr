-- ============================================
-- PLAYER GAME STATS CACHE TABLE
-- Caches player stats for each game to avoid duplicate API calls
-- ============================================

CREATE TABLE IF NOT EXISTS player_game_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  pts INTEGER DEFAULT 0,
  reb INTEGER DEFAULT 0,
  ast INTEGER DEFAULT 0,
  stl INTEGER DEFAULT 0,
  blk INTEGER DEFAULT 0,
  fg3m INTEGER DEFAULT 0,
  min TEXT,
  team_id INTEGER,
  team_abbreviation TEXT,
  opponent_id INTEGER,
  opponent_abbreviation TEXT,
  game_date DATE,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(game_id, player_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_player_game_stats_game_player ON player_game_stats(game_id, player_id);
CREATE INDEX IF NOT EXISTS idx_player_game_stats_game_date ON player_game_stats(game_date);

-- Add comment
COMMENT ON TABLE player_game_stats IS 'Cache for player stats per game. Stats never change after game ends, so cache is permanent.';

