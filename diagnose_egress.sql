-- ============================================
-- EGRESS DIAGNOSTIC QUERIES
-- Run these in Supabase SQL Editor to identify what's causing high egress
-- ============================================

-- 0. FIRST: Check which tables exist in your database
-- Run this first to see what tables are available
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size('public.' || tablename)) AS total_size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('bets', 'tracked_props', 'historical_odds', 'odds_snapshots', 
                    'line_movement_latest', 'line_movement_events', 'dvp_rank_snapshots', 
                    'players', 'profiles', 'nba_cache')
ORDER BY pg_total_relation_size('public.' || tablename) DESC NULLS LAST;

-- 1. TABLE SIZES - Row counts for all main tables
-- This shows which tables have the most data
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
  pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 2. ROW COUNTS - Count rows in each main table (only queries tables that exist)
-- This helps identify tables with many rows that might be queried frequently
-- Note: Run each section separately if a table doesn't exist

-- Core tables (should always exist)
SELECT 
  'bets' AS table_name,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS rows_last_7_days,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS rows_last_30_days
FROM bets
UNION ALL
SELECT 
  'tracked_props' AS table_name,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS rows_last_7_days,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS rows_last_30_days
FROM tracked_props
UNION ALL
SELECT 
  'profiles' AS table_name,
  COUNT(*) AS row_count,
  NULL AS rows_last_7_days,
  NULL AS rows_last_30_days
FROM profiles
ORDER BY row_count DESC;

-- Optional tables (comment out if table doesn't exist)
-- Uncomment the sections below for tables that exist in your database:

/*
-- Historical odds (may not exist)
SELECT 
  'historical_odds' AS table_name,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS rows_last_7_days,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS rows_last_30_days
FROM historical_odds;
*/

/*
-- Odds snapshots
SELECT 
  'odds_snapshots' AS table_name,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE snapshot_at > NOW() - INTERVAL '7 days') AS rows_last_7_days,
  COUNT(*) FILTER (WHERE snapshot_at > NOW() - INTERVAL '30 days') AS rows_last_30_days
FROM odds_snapshots;
*/

/*
-- Line movement tables
SELECT 
  'line_movement_latest' AS table_name,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days') AS rows_last_7_days,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '30 days') AS rows_last_30_days
FROM line_movement_latest
UNION ALL
SELECT 
  'line_movement_events' AS table_name,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '7 days') AS rows_last_7_days,
  COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '30 days') AS rows_last_30_days
FROM line_movement_events;
*/

/*
-- DvP rank snapshots
SELECT 
  'dvp_rank_snapshots' AS table_name,
  COUNT(*) AS row_count,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS rows_last_7_days,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS rows_last_30_days
FROM dvp_rank_snapshots;
*/

/*
-- Players cache
SELECT 
  'players' AS table_name,
  COUNT(*) AS row_count,
  NULL AS rows_last_7_days,
  NULL AS rows_last_30_days
FROM players;
*/

-- 3. BETS TABLE ANALYSIS - Most problematic table
-- Check how many bets per user (users with many bets cause high egress)
SELECT 
  user_id,
  COUNT(*) AS total_bets,
  COUNT(*) FILTER (WHERE status = 'pending' OR status = 'live') AS pending_bets,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS bets_last_7_days,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS bets_last_30_days,
  MIN(created_at) AS first_bet,
  MAX(created_at) AS last_bet
FROM bets
GROUP BY user_id
ORDER BY total_bets DESC
LIMIT 20;

-- 4. LARGE TEXT/JSON COLUMNS
-- Check for large columns that might be causing excessive data transfer
-- (Note: This is an estimate - actual column sizes vary)
SELECT 
  'bets' AS table_name,
  AVG(LENGTH(COALESCE(selection::text, ''))) AS avg_selection_size,
  AVG(LENGTH(COALESCE(parlay_legs::text, ''))) AS avg_parlay_legs_size,
  MAX(LENGTH(COALESCE(parlay_legs::text, ''))) AS max_parlay_legs_size
FROM bets
WHERE parlay_legs IS NOT NULL
UNION ALL
SELECT 
  'odds_snapshots' AS table_name,
  NULL AS avg_selection_size,
  NULL AS avg_parlay_legs_size,
  NULL AS max_parlay_legs_size
FROM odds_snapshots
LIMIT 1;

-- 5. FREQUENTLY QUERIED DATA PATTERNS
-- Check for patterns that might indicate frequent full table scans
-- Pending bets that are queried often
SELECT 
  COUNT(*) AS total_pending_bets,
  COUNT(DISTINCT user_id) AS users_with_pending_bets,
  COUNT(*) FILTER (WHERE game_date < CURRENT_DATE - INTERVAL '7 days') AS old_pending_bets
FROM bets
WHERE status IN ('pending', 'live')
  AND sport = 'NBA'
  AND game_date IS NOT NULL;

-- 6. ODD SNAPSHOTS GROWTH (only if table exists)
-- Check if odds_snapshots is growing too fast (this table can get very large)
-- Uncomment if odds_snapshots table exists:
/*
SELECT 
  DATE_TRUNC('day', snapshot_at) AS snapshot_date,
  COUNT(*) AS snapshots_per_day,
  COUNT(DISTINCT game_id) AS unique_games,
  COUNT(DISTINCT player_name) AS unique_players,
  COUNT(DISTINCT bookmaker) AS unique_bookmakers
FROM odds_snapshots
WHERE snapshot_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', snapshot_at)
ORDER BY snapshot_date DESC;
*/

-- 7. LINE MOVEMENT EVENTS GROWTH (only if table exists)
-- Check line_movement_events table growth
-- Uncomment if line_movement_events table exists:
/*
SELECT 
  DATE_TRUNC('day', recorded_at) AS event_date,
  COUNT(*) AS events_per_day,
  COUNT(DISTINCT composite_key) AS unique_keys
FROM line_movement_events
WHERE recorded_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', recorded_at)
ORDER BY event_date DESC;
*/

-- 8. HISTORICAL ODDS DUPLICATES (only if table exists)
-- Check if historical_odds has excessive duplicates or old data
-- Uncomment if historical_odds table exists:
/*
SELECT 
  COUNT(*) AS total_odds_records,
  COUNT(DISTINCT (player_id, game_date, opponent, stat_type, bookmaker)) AS unique_combinations,
  COUNT(*) - COUNT(DISTINCT (player_id, game_date, opponent, stat_type, bookmaker)) AS potential_duplicates,
  COUNT(*) FILTER (WHERE game_date < CURRENT_DATE - INTERVAL '90 days') AS old_records_90_days,
  COUNT(*) FILTER (WHERE game_date < CURRENT_DATE - INTERVAL '180 days') AS old_records_180_days
FROM historical_odds;
*/

-- 9. ESTIMATED DATA SIZE PER ROW
-- Estimate average row size for key tables (helps understand egress per query)
SELECT 
  'bets' AS table_name,
  pg_size_pretty(SUM(pg_column_size(bets.*))) AS total_data_size,
  COUNT(*) AS row_count,
  pg_size_pretty(SUM(pg_column_size(bets.*)) / NULLIF(COUNT(*), 0)) AS avg_row_size
FROM bets;

-- Uncomment for other tables if they exist:
/*
UNION ALL
SELECT 
  'odds_snapshots' AS table_name,
  pg_size_pretty(SUM(pg_column_size(odds_snapshots.*))) AS total_data_size,
  COUNT(*) AS row_count,
  pg_size_pretty(SUM(pg_column_size(odds_snapshots.*)) / NULLIF(COUNT(*), 0)) AS avg_row_size
FROM odds_snapshots
UNION ALL
SELECT 
  'line_movement_events' AS table_name,
  pg_size_pretty(SUM(pg_column_size(line_movement_events.*))) AS total_data_size,
  COUNT(*) AS row_count,
  pg_size_pretty(SUM(pg_column_size(line_movement_events.*)) / NULLIF(COUNT(*), 0)) AS avg_row_size
FROM line_movement_events;
*/

-- 10. TOP USERS BY BET COUNT
-- Identify users who might be causing high egress when their bets are fetched
SELECT 
  user_id,
  COUNT(*) AS bet_count,
  pg_size_pretty(SUM(pg_column_size(bets.*))) AS estimated_data_size
FROM bets
GROUP BY user_id
ORDER BY bet_count DESC
LIMIT 10;

-- 11. CHECK FOR LARGE PARLAY_LEGS COLUMNS
-- Parlay legs stored as JSON can be large
SELECT 
  COUNT(*) AS bets_with_parlays,
  AVG(LENGTH(parlay_legs::text)) AS avg_parlay_json_size,
  MAX(LENGTH(parlay_legs::text)) AS max_parlay_json_size,
  pg_size_pretty(SUM(LENGTH(parlay_legs::text))) AS total_parlay_data_size
FROM bets
WHERE parlay_legs IS NOT NULL;

-- 12. RECENT ACTIVITY SUMMARY
-- Summary of recent data activity that might indicate high query frequency
SELECT 
  'Bets created (last 24h)' AS metric,
  COUNT(*)::text AS value
FROM bets
WHERE created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'Bets created (last 7 days)' AS metric,
  COUNT(*)::text AS value
FROM bets
WHERE created_at > NOW() - INTERVAL '7 days'
UNION ALL
SELECT 
  'Total pending/live bets' AS metric,
  COUNT(*)::text AS value
FROM bets
WHERE status IN ('pending', 'live');

-- Uncomment for other tables if they exist:
/*
UNION ALL
SELECT 
  'Odds snapshots (last 24h)' AS metric,
  COUNT(*)::text AS value
FROM odds_snapshots
WHERE snapshot_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'Line movement events (last 24h)' AS metric,
  COUNT(*)::text AS value
FROM line_movement_events
WHERE recorded_at > NOW() - INTERVAL '24 hours'
*/

-- ============================================
-- RECOMMENDATIONS BASED ON RESULTS:
-- ============================================
-- 1. If bets table has users with 1000+ bets:
--    → Add pagination/limits to journal page queries
--
-- 2. If odds_snapshots has millions of rows:
--    → Consider archiving old snapshots (>30 days)
--    → Add date filters to queries
--
-- 3. If line_movement_events is growing fast:
--    → Archive old events (>90 days)
--
-- 4. If historical_odds has old records:
--    → Archive odds older than 180 days
--
-- 5. If parlay_legs columns are large:
--    → Consider fetching parlay_legs separately only when needed
--
-- 6. If pending bets count is high:
--    → Optimize check-journal-bets to skip resolved bets
--    → Add limits to batch queries
