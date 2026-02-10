-- ============================================
-- ADD COMPOSITE STATS COLUMNS TO PLAYER_GAME_STATS
-- Adds PRA, PR, PA, RA columns for pre-calculated composite stats
-- ============================================

-- Add composite stat columns if they don't exist
ALTER TABLE player_game_stats 
  ADD COLUMN IF NOT EXISTS pra INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pr INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pa INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ra INTEGER DEFAULT 0;

-- Update existing rows to calculate composite stats
UPDATE player_game_stats
SET 
  pra = COALESCE(pts, 0) + COALESCE(reb, 0) + COALESCE(ast, 0),
  pr = COALESCE(pts, 0) + COALESCE(reb, 0),
  pa = COALESCE(pts, 0) + COALESCE(ast, 0),
  ra = COALESCE(reb, 0) + COALESCE(ast, 0)
WHERE pra IS NULL OR pr IS NULL OR pa IS NULL OR ra IS NULL;

-- Add comment
COMMENT ON COLUMN player_game_stats.pra IS 'Pre-calculated Points + Rebounds + Assists for accuracy';
COMMENT ON COLUMN player_game_stats.pr IS 'Pre-calculated Points + Rebounds for accuracy';
COMMENT ON COLUMN player_game_stats.pa IS 'Pre-calculated Points + Assists for accuracy';
COMMENT ON COLUMN player_game_stats.ra IS 'Pre-calculated Rebounds + Assists for accuracy';
