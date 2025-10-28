-- ============================================
-- PLAYER TRACKING & JOURNAL ENHANCEMENTS
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. CREATE TRACKED_PROPS TABLE (Watchlist)
CREATE TABLE IF NOT EXISTS tracked_props (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  stat_type TEXT NOT NULL CHECK (stat_type IN ('pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'pr', 'pra', 'ra')),
  line DECIMAL(10,2) NOT NULL,
  over_under TEXT NOT NULL CHECK (over_under IN ('over', 'under')),
  game_date DATE NOT NULL,
  opponent TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'void')),
  result TEXT CHECK (result IN ('win', 'loss', 'pending')),
  actual_value DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. ADD COLUMNS TO EXISTING BETS TABLE FOR NBA PROPS
ALTER TABLE bets ADD COLUMN IF NOT EXISTS player_id TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS player_name TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS team TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS opponent TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS stat_type TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS line DECIMAL(10,2);
ALTER TABLE bets ADD COLUMN IF NOT EXISTS over_under TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS actual_value DECIMAL(10,2);
ALTER TABLE bets ADD COLUMN IF NOT EXISTS game_date DATE;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- 3. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_tracked_props_user_id ON tracked_props(user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_props_player_id ON tracked_props(player_id);
CREATE INDEX IF NOT EXISTS idx_tracked_props_game_date ON tracked_props(game_date);
CREATE INDEX IF NOT EXISTS idx_tracked_props_status ON tracked_props(status);

CREATE INDEX IF NOT EXISTS idx_bets_player_id ON bets(player_id);
CREATE INDEX IF NOT EXISTS idx_bets_game_date ON bets(game_date);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);

-- 4. ENABLE ROW LEVEL SECURITY
ALTER TABLE tracked_props ENABLE ROW LEVEL SECURITY;

-- 5. CREATE RLS POLICIES FOR TRACKED_PROPS
CREATE POLICY "Users can view their own tracked props" ON tracked_props
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tracked props" ON tracked_props
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tracked props" ON tracked_props
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tracked props" ON tracked_props
  FOR DELETE USING (auth.uid() = user_id);

-- 6. CREATE TRIGGER FOR UPDATED_AT
CREATE TRIGGER update_tracked_props_updated_at 
  BEFORE UPDATE ON tracked_props 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 7. CREATE VIEW FOR ACTIVE TRACKED PROPS (pending only)
CREATE OR REPLACE VIEW active_tracked_props AS
SELECT * FROM tracked_props
WHERE status = 'pending'
ORDER BY game_date ASC, created_at ASC;
