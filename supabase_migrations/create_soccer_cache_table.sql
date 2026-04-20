-- Soccer API Cache Table
-- Stores cached Soccerway team results and match stats in Supabase for persistent, shared access

CREATE TABLE IF NOT EXISTS soccer_api_cache (
  id BIGSERIAL PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  cache_type TEXT NOT NULL, -- 'team_results', 'match_stats', 'team_index', etc.
  team_href TEXT,
  match_id TEXT,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soccer_cache_key ON soccer_api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_soccer_cache_type ON soccer_api_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_soccer_cache_team_href ON soccer_api_cache(team_href);
CREATE INDEX IF NOT EXISTS idx_soccer_cache_match_id ON soccer_api_cache(match_id);
CREATE INDEX IF NOT EXISTS idx_soccer_cache_expires ON soccer_api_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_soccer_cache_type_expires ON soccer_api_cache(cache_type, expires_at);

CREATE OR REPLACE FUNCTION update_soccer_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_soccer_cache_updated_at ON soccer_api_cache;
CREATE TRIGGER update_soccer_cache_updated_at
  BEFORE UPDATE ON soccer_api_cache
  FOR EACH ROW EXECUTE PROCEDURE update_soccer_cache_updated_at();

CREATE OR REPLACE FUNCTION cleanup_expired_soccer_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM soccer_api_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ language 'plpgsql';

COMMENT ON TABLE soccer_api_cache IS 'Persistent cache for Soccerway team results and match stats.';
COMMENT ON COLUMN soccer_api_cache.cache_key IS 'Unique cache key (e.g., soccer:team-results:v1:/team/arsenal/hA1Zm19f)';
COMMENT ON COLUMN soccer_api_cache.cache_type IS 'Cache bucket for filtering and maintenance.';
COMMENT ON COLUMN soccer_api_cache.team_href IS 'Normalized Soccerway team href when the cache row is team scoped.';
COMMENT ON COLUMN soccer_api_cache.match_id IS 'Soccerway/Flashscore match identifier when the cache row is match scoped.';
COMMENT ON COLUMN soccer_api_cache.data IS 'Cached JSON payload.';
COMMENT ON COLUMN soccer_api_cache.fetched_at IS 'When the upstream Soccerway payload was fetched.';
COMMENT ON COLUMN soccer_api_cache.expires_at IS 'When this cache entry should be considered stale and refreshed.';
