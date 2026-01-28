-- ============================================
-- BIGGEST EGRESS SOURCES - Single Query
-- Shows which tables are contributing most to egress
-- Ordered by total size (biggest first)
-- ============================================

SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size('public.' || tablename)) AS total_size,
  pg_total_relation_size('public.' || tablename) AS total_bytes,
  pg_size_pretty(pg_relation_size('public.' || tablename)) AS data_size,
  pg_size_pretty(pg_indexes_size('public.' || tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('bets', 'tracked_props', 'historical_odds', 'odds_snapshots', 
                    'line_movement_latest', 'line_movement_events', 'dvp_rank_snapshots', 
                    'players', 'profiles', 'nba_cache')
ORDER BY pg_total_relation_size('public.' || tablename) DESC NULLS LAST;
