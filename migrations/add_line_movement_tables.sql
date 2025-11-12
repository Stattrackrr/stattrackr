-- Create table to store latest line information per player/bookmaker/market
CREATE TABLE IF NOT EXISTS line_movement_latest (
    composite_key TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    market TEXT NOT NULL,
    bookmaker TEXT NOT NULL,
    opening_line DOUBLE PRECISION,
    opening_over_odds INTEGER,
    opening_under_odds INTEGER,
    opening_recorded_at TIMESTAMPTZ,
    current_line DOUBLE PRECISION,
    current_over_odds INTEGER,
    current_under_odds INTEGER,
    current_recorded_at TIMESTAMPTZ,
    line_last_changed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_movement_latest_player_market
    ON line_movement_latest (player_name, market);

CREATE INDEX IF NOT EXISTS idx_line_movement_latest_game
    ON line_movement_latest (game_id);

-- Table storing individual line movement events (only when the line actually changes)
CREATE TABLE IF NOT EXISTS line_movement_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    composite_key TEXT NOT NULL,
    game_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    market TEXT NOT NULL,
    bookmaker TEXT NOT NULL,
    previous_line DOUBLE PRECISION,
    new_line DOUBLE PRECISION NOT NULL,
    change DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_movement_events_key_time
    ON line_movement_events (composite_key, recorded_at DESC);

COMMENT ON TABLE line_movement_latest IS 'Latest line snapshot per bookmaker for a given player/stat.';
COMMENT ON TABLE line_movement_events IS 'History of line changes for a player/stat/bookmaker combination.';

