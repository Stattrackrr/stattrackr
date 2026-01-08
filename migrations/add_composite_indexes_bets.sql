-- ============================================
-- COMPOSITE INDEXES FOR BETS TABLE
-- Optimizes journal queries and check-journal-bets API
-- ============================================

-- 1. Composite index for journal page queries (user_id + date DESC)
-- This optimizes: SELECT * FROM bets WHERE user_id = ? ORDER BY date DESC
CREATE INDEX IF NOT EXISTS idx_bets_user_date_desc ON bets(user_id, date DESC NULLS LAST);

-- 2. Composite index for check-journal-bets API queries
-- This optimizes: SELECT * FROM bets WHERE user_id = ? AND sport = 'NBA' AND (result = 'pending' OR status = 'live')
CREATE INDEX IF NOT EXISTS idx_bets_user_sport_status ON bets(user_id, sport, status) 
  WHERE sport = 'NBA' AND (result IN ('pending', 'win', 'loss') OR status IN ('pending', 'live'));

-- 3. Composite index for game_date queries (used in check-journal-bets)
-- This optimizes: SELECT * FROM bets WHERE user_id = ? AND game_date = ? AND sport = 'NBA'
CREATE INDEX IF NOT EXISTS idx_bets_user_game_date ON bets(user_id, game_date, sport) 
  WHERE game_date IS NOT NULL AND sport = 'NBA';

-- 4. Composite index for player_id queries (used in check-journal-bets)
-- This optimizes: SELECT * FROM bets WHERE user_id = ? AND player_id = ? AND game_date = ?
CREATE INDEX IF NOT EXISTS idx_bets_user_player_game_date ON bets(user_id, player_id, game_date) 
  WHERE player_id IS NOT NULL AND game_date IS NOT NULL;

-- 5. Index for updated_at (used in periodic refresh optimization)
-- This optimizes: SELECT * FROM bets WHERE user_id = ? AND updated_at > ?
CREATE INDEX IF NOT EXISTS idx_bets_user_updated_at ON bets(user_id, updated_at DESC);

-- 6. Composite index for parlay queries
-- This optimizes: SELECT * FROM bets WHERE user_id = ? AND sport = 'NBA' AND market LIKE 'Parlay%'
CREATE INDEX IF NOT EXISTS idx_bets_user_market ON bets(user_id, sport, market) 
  WHERE market LIKE 'Parlay%' AND sport = 'NBA';

-- Note: These indexes use partial indexes (WHERE clauses) to reduce index size
-- and improve performance for specific query patterns used by the journal system.

