-- ============================================
-- FIND BET IDS - Helper Queries
-- Use these to find bet IDs before editing
-- ============================================

-- 1. Find bet by selection text (partial match)
SELECT 
  id,
  date,
  selection,
  result,
  stake,
  odds,
  player_name,
  created_at
FROM bets
WHERE selection ILIKE '%search_text%'    -- Replace 'search_text' with what you're looking for
ORDER BY created_at DESC;

-- 2. Find bet by player name
SELECT 
  id,
  player_name,
  team,
  opponent,
  stat_type,
  line,
  over_under,
  game_date,
  result,
  stake,
  odds
FROM bets
WHERE player_name ILIKE '%player_name%'   -- Replace 'player_name' with actual name
ORDER BY game_date DESC, created_at DESC;

-- 3. Find bet by date range
SELECT 
  id,
  date,
  selection,
  result,
  stake,
  odds,
  player_name
FROM bets
WHERE date >= '2024-01-01'                -- Start date
  AND date <= '2024-01-31'                -- End date
ORDER BY date DESC;

-- 4. Find bet by user email
SELECT 
  b.id,
  b.date,
  b.selection,
  b.result,
  b.stake,
  b.odds,
  u.email as user_email
FROM bets b
INNER JOIN auth.users u ON b.user_id = u.id
WHERE u.email = 'user@example.com'       -- Replace with actual email
ORDER BY b.created_at DESC;

-- 5. Find pending bets
SELECT 
  id,
  date,
  selection,
  result,
  status,
  player_name,
  game_date
FROM bets
WHERE result = 'pending' OR status IN ('pending', 'live')
ORDER BY 
  CASE 
    WHEN game_date IS NOT NULL THEN game_date
    ELSE date
  END ASC;

-- 6. Find bets by result type
SELECT 
  id,
  date,
  selection,
  result,
  stake,
  odds
FROM bets
WHERE result = 'win'                      -- Change to: 'win', 'loss', 'void', or 'pending'
ORDER BY date DESC;

-- 7. Find parlay bets
SELECT 
  id,
  date,
  market,
  selection,
  result,
  stake,
  odds,
  jsonb_array_length(COALESCE(parlay_legs, '[]'::jsonb)) as num_legs
FROM bets
WHERE market LIKE 'Parlay%' OR parlay_legs IS NOT NULL
ORDER BY created_at DESC;

-- 8. Find bets by sport
SELECT 
  id,
  date,
  sport,
  selection,
  result,
  stake,
  odds
FROM bets
WHERE sport = 'NBA'                       -- Change sport as needed
ORDER BY date DESC;

-- 9. Find bets by bookmaker
SELECT 
  id,
  date,
  selection,
  bookmaker,
  result,
  stake,
  odds
FROM bets
WHERE bookmaker ILIKE '%bookmaker_name%'  -- Replace with bookmaker name
ORDER BY date DESC;

-- 10. Find recent bets (last 24 hours)
SELECT 
  id,
  date,
  selection,
  result,
  created_at
FROM bets
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- 11. Find bets with specific stat type
SELECT 
  id,
  player_name,
  stat_type,
  line,
  over_under,
  game_date,
  result,
  actual_value
FROM bets
WHERE stat_type = 'pts'                   -- Change to: pts, reb, ast, stl, blk, fg3m, pr, pra, ra
ORDER BY game_date DESC;

-- 12. Find bets by team
SELECT 
  id,
  player_name,
  team,
  opponent,
  game_date,
  result
FROM bets
WHERE team ILIKE '%team_name%'            -- Replace with team name
ORDER BY game_date DESC;

-- 13. Find all bet IDs for a user (simple list)
SELECT id
FROM bets
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'user@example.com'  -- Replace with email
)
ORDER BY created_at DESC;

-- 14. Find bet with full details by ID
SELECT *
FROM bets
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- 15. Find bets needing correction (example: missing bookmaker)
SELECT 
  id,
  date,
  selection,
  sport,
  bookmaker
FROM bets
WHERE bookmaker IS NULL
  AND sport = 'NBA'
ORDER BY created_at DESC;





















