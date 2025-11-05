-- Create table for storing odds snapshots for line movement tracking
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  
  -- Game identification
  game_id TEXT NOT NULL,
  player_name TEXT, -- NULL for game odds, populated for player props
  
  -- Odds details
  bookmaker TEXT NOT NULL,
  market TEXT NOT NULL, -- 'h2h', 'spreads', 'totals', 'player_points', 'player_rebounds', etc.
  
  -- Line value and odds
  line NUMERIC, -- Point spread, total line, or player prop line (NULL for h2h)
  over_odds INTEGER, -- American odds for over/home/yes
  under_odds INTEGER, -- American odds for under/away/no
  
  -- Timestamp
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Create index for efficient queries
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_game_player ON odds_snapshots(game_id, player_name, market);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_market ON odds_snapshots(market);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_snapshot_at ON odds_snapshots(snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_bookmaker ON odds_snapshots(bookmaker);

-- Composite index for line movement queries
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_line_movement ON odds_snapshots(game_id, player_name, market, bookmaker, snapshot_at DESC);

COMMENT ON TABLE odds_snapshots IS 'Historical odds data for tracking line movement';
COMMENT ON COLUMN odds_snapshots.game_id IS 'Unique identifier for the game from The Odds API';
COMMENT ON COLUMN odds_snapshots.player_name IS 'Player name for player props, NULL for game odds';
COMMENT ON COLUMN odds_snapshots.market IS 'Market type from The Odds API (h2h, spreads, totals, player_points, etc)';
COMMENT ON COLUMN odds_snapshots.line IS 'Point spread, total, or prop line value';
COMMENT ON COLUMN odds_snapshots.snapshot_at IS 'When this odds snapshot was recorded';
