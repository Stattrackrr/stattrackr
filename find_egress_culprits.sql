-- ============================================
-- FIND EGRESS CULPRITS - What's actually causing 6GB egress
-- Egress = data transferred OUT, not storage size
-- ============================================

-- 1. ROW COUNTS - Tables with many rows = potential for large result sets
SELECT 
  'bets' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS rows_last_7_days
FROM bets
UNION ALL
SELECT 
  'tracked_props',
  COUNT(*),
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')
FROM tracked_props
UNION ALL
SELECT 
  'dvp_rank_snapshots',
  COUNT(*),
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')
FROM dvp_rank_snapshots
UNION ALL
SELECT 
  'line_movement_events',
  COUNT(*),
  COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '7 days')
FROM line_movement_events
UNION ALL
SELECT 
  'line_movement_latest',
  COUNT(*),
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days')
FROM line_movement_latest
UNION ALL
SELECT 
  'odds_snapshots',
  COUNT(*),
  COUNT(*) FILTER (WHERE snapshot_at > NOW() - INTERVAL '7 days')
FROM odds_snapshots
UNION ALL
SELECT 
  'players',
  COUNT(*),
  NULL
FROM players
ORDER BY total_rows DESC;

-- 2. ESTIMATED EGRESS PER TABLE - If someone queries ALL rows
-- This shows how much data would be transferred if a query fetches all rows
-- THIS IS THE KEY METRIC - shows potential egress per full table query
SELECT 
  'players' AS table_name,
  COUNT(*) AS row_count,
  pg_size_pretty(SUM(pg_column_size(players.*))) AS total_data_if_all_queried,
  SUM(pg_column_size(players.*)) AS total_bytes,
  '⚠️ similar-players API fetches ALL players without limit!' AS warning
FROM players
UNION ALL
SELECT 
  'dvp_rank_snapshots',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(dvp_rank_snapshots.*))),
  SUM(pg_column_size(dvp_rank_snapshots.*)),
  NULL
FROM dvp_rank_snapshots
UNION ALL
SELECT 
  'line_movement_events',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(line_movement_events.*))),
  SUM(pg_column_size(line_movement_events.*)),
  NULL
FROM line_movement_events
UNION ALL
SELECT 
  'odds_snapshots',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(odds_snapshots.*))),
  SUM(pg_column_size(odds_snapshots.*)),
  NULL
FROM odds_snapshots
UNION ALL
SELECT 
  'bets',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(bets.*))),
  SUM(pg_column_size(bets.*)),
  '⚠️ check-journal-bets can fetch up to 2000 bets'
FROM bets
UNION ALL
SELECT 
  'tracked_props',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(tracked_props.*))),
  SUM(pg_column_size(tracked_props.*)),
  NULL
FROM tracked_props
UNION ALL
SELECT 
  'line_movement_latest',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(line_movement_latest.*))),
  SUM(pg_column_size(line_movement_latest.*)),
  NULL
FROM line_movement_latest
ORDER BY total_bytes DESC;

-- 3. USERS WITH MANY BETS - If journal page fetches all bets per user
-- Each user query could transfer significant data
SELECT 
  user_id,
  COUNT(*) AS bet_count,
  pg_size_pretty(SUM(pg_column_size(bets.*))) AS estimated_data_size_if_all_queried,
  SUM(pg_column_size(bets.*)) AS total_bytes
FROM bets
GROUP BY user_id
ORDER BY bet_count DESC
LIMIT 20;

-- 4. LARGE JSON COLUMNS - Check if parlay_legs or other JSON is huge
SELECT 
  COUNT(*) AS bets_with_parlays,
  pg_size_pretty(SUM(LENGTH(parlay_legs::text))) AS total_parlay_data_size,
  SUM(LENGTH(parlay_legs::text)) AS total_bytes,
  AVG(LENGTH(parlay_legs::text)) AS avg_size_per_bet,
  MAX(LENGTH(parlay_legs::text)) AS max_size_single_bet
FROM bets
WHERE parlay_legs IS NOT NULL;

-- 5. POTENTIAL EGRESS IF QUERIED FREQUENTLY
-- Shows how much data could be transferred if these queries run often
SELECT 
  'Players table (ALL rows)' AS query_type,
  COUNT(*) AS row_count,
  pg_size_pretty(SUM(pg_column_size(players.*))) AS data_size,
  SUM(pg_column_size(players.*)) AS bytes,
  'similar-players API - NO LIMIT!' AS issue
FROM players
UNION ALL
SELECT 
  'DvP snapshots (ALL rows)',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(dvp_rank_snapshots.*))),
  SUM(pg_column_size(dvp_rank_snapshots.*)),
  'Could be queried without date filters'
FROM dvp_rank_snapshots
UNION ALL
SELECT 
  'Line movement events (ALL rows)',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(line_movement_events.*))),
  SUM(pg_column_size(line_movement_events.*)),
  'Could be queried without date filters'
FROM line_movement_events
UNION ALL
SELECT 
  'Odds snapshots (ALL rows)',
  COUNT(*),
  pg_size_pretty(SUM(pg_column_size(odds_snapshots.*))),
  SUM(pg_column_size(odds_snapshots.*)),
  'Could be queried without date filters'
FROM odds_snapshots
UNION ALL
SELECT 
  'Bets (up to 2000 in check-journal-bets)',
  LEAST(COUNT(*), 2000),
  pg_size_pretty(SUM(pg_column_size(bets.*)) / NULLIF(COUNT(*), 0) * LEAST(COUNT(*), 2000)),
  (SUM(pg_column_size(bets.*)) / NULLIF(COUNT(*), 0) * LEAST(COUNT(*), 2000)),
  'check-journal-bets has 2000 limit'
FROM bets
ORDER BY bytes DESC;
