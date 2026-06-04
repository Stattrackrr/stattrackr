-- ============================================
-- WORLD CUP CACHE TABLE
-- Permanent (no-expiry) key/value cache for World Cup BDL data:
--   * Player search results (search query -> resolved player names)
--   * Dashboard payloads (selected player/team -> assembled stats)
-- Stored in Supabase so the BDL API is only hit once per unique key.
-- ============================================

CREATE TABLE IF NOT EXISTS world_cup_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prefix lookups (e.g. clearing all "wc:player-search:..." keys).
CREATE INDEX IF NOT EXISTS idx_world_cup_cache_key_prefix
  ON world_cup_cache (cache_key text_pattern_ops);

COMMENT ON TABLE world_cup_cache IS 'Permanent key/value cache for World Cup BDL player searches and dashboard stats. Entries never expire; refresh by upsert.';
