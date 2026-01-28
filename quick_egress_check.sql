-- ============================================
-- QUICK EGRESS CHECK - Run this first for a quick overview
-- ============================================

-- Quick summary of table sizes and row counts
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size('public.' || tablename)) AS total_size,
  pg_size_pretty(pg_relation_size('public.' || tablename)) AS table_size,
  (SELECT COUNT(*) FROM information_schema.tables t2 
   WHERE t2.table_schema = 'public' 
   AND t2.table_name = tablename) AS has_table
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('bets', 'tracked_props', 'historical_odds', 'odds_snapshots', 
                    'line_movement_latest', 'line_movement_events', 'dvp_rank_snapshots', 
                    'players', 'profiles')
ORDER BY pg_total_relation_size('public.' || tablename) DESC;

-- Row counts for main tables (quick check)
-- Core tables that should always exist:
SELECT 
  (SELECT COUNT(*) FROM bets) AS bets_count,
  (SELECT COUNT(*) FROM tracked_props) AS tracked_props_count,
  (SELECT COUNT(*) FROM bets WHERE status IN ('pending', 'live')) AS pending_bets_count,
  (SELECT COUNT(DISTINCT user_id) FROM bets) AS unique_users_with_bets;

-- Optional tables (uncomment if they exist):
/*
SELECT 
  (SELECT COUNT(*) FROM odds_snapshots) AS odds_snapshots_count,
  (SELECT COUNT(*) FROM line_movement_events) AS line_movement_events_count;
*/

-- Top 5 users by bet count (likely causing high egress)
SELECT 
  user_id,
  COUNT(*) AS bet_count
FROM bets
GROUP BY user_id
ORDER BY bet_count DESC
LIMIT 5;
