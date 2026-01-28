-- ============================================
-- CHECK DVP QUERY SIZE - How much data does the historical query return?
-- This shows why the historical DvP API might be causing high egress
-- ============================================

-- 1. How many rows would a typical historical query return?
-- This simulates what the API query does: season + position + metric + date filter
SELECT 
  season,
  position,
  metric,
  COUNT(*) AS total_snapshots,
  COUNT(DISTINCT team) AS unique_teams,
  COUNT(DISTINCT snapshot_date) AS unique_dates,
  pg_size_pretty(SUM(pg_column_size(dvp_rank_snapshots.*))) AS total_data_size,
  SUM(pg_column_size(dvp_rank_snapshots.*)) AS total_bytes,
  '⚠️ Historical API fetches ALL of these rows, then filters in JS!' AS issue
FROM dvp_rank_snapshots
GROUP BY season, position, metric
ORDER BY total_snapshots DESC
LIMIT 20;

-- 2. For a specific query (like the API does), how many rows?
-- Example: season=2025, position=PG, metric=pts, date <= today
SELECT 
  COUNT(*) AS rows_returned,
  COUNT(DISTINCT team) AS unique_teams,
  COUNT(DISTINCT snapshot_date) AS unique_dates,
  pg_size_pretty(SUM(pg_column_size(dvp_rank_snapshots.*))) AS data_size,
  SUM(pg_column_size(dvp_rank_snapshots.*)) AS bytes,
  'This is what ONE historical API call returns!' AS note
FROM dvp_rank_snapshots
WHERE season = 2025
  AND position = 'PG'
  AND metric = 'pts'
  AND snapshot_date <= CURRENT_DATE;

-- 3. Check all position/metric combinations
SELECT 
  position,
  metric,
  COUNT(*) AS total_rows,
  pg_size_pretty(SUM(pg_column_size(dvp_rank_snapshots.*))) AS data_size,
  SUM(pg_column_size(dvp_rank_snapshots.*)) AS bytes
FROM dvp_rank_snapshots
WHERE season = 2025
GROUP BY position, metric
ORDER BY bytes DESC;

-- 4. If the API is called for many games/dates, this multiplies
-- Show how many unique date/position/metric combinations exist
SELECT 
  COUNT(DISTINCT (snapshot_date, position, metric)) AS unique_combinations,
  'Each combination could trigger a separate API call' AS note
FROM dvp_rank_snapshots
WHERE season = 2025;
