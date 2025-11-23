-- NBA API Cache Table
-- Stores cached NBA API responses in Supabase for persistent, shared access
-- This allows Vercel to read cached data even though it can't reach NBA API directly

CREATE TABLE IF NOT EXISTS nba_api_cache (
  id BIGSERIAL PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  cache_type TEXT NOT NULL, -- 'shot_chart', 'play_type', 'team_tracking', 'defense_rankings', etc.
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_nba_cache_key ON nba_api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_nba_cache_type ON nba_api_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_nba_cache_expires ON nba_api_cache(expires_at);

-- Index for efficient cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_nba_cache_expires_type ON nba_api_cache(expires_at, cache_type);

-- Function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_nba_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_nba_cache_updated_at 
  BEFORE UPDATE ON nba_api_cache 
  FOR EACH ROW EXECUTE PROCEDURE update_nba_cache_updated_at();

-- Function to clean up expired cache entries (can be called by cron)
CREATE OR REPLACE FUNCTION cleanup_expired_nba_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM nba_api_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ language 'plpgsql';

COMMENT ON TABLE nba_api_cache IS 'Persistent cache for NBA API responses. Populated by external service, read by Vercel.';
COMMENT ON COLUMN nba_api_cache.cache_key IS 'Unique cache key (e.g., shot_enhanced_203924_OKC_2025)';
COMMENT ON COLUMN nba_api_cache.cache_type IS 'Type of cached data for filtering and management';
COMMENT ON COLUMN nba_api_cache.data IS 'Cached JSON response data';
COMMENT ON COLUMN nba_api_cache.expires_at IS 'When this cache entry expires and should be refreshed';

