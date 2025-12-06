-- ============================================
-- EDIT/UPDATE JOURNAL BETS SCRIPT
-- Run this in your Supabase SQL Editor
-- ============================================
-- WARNING: Always test updates on a single bet first before bulk updates!
-- Use transactions to rollback if needed: BEGIN; ... UPDATE ...; ROLLBACK; (to test) or COMMIT; (to apply)

-- ============================================
-- 1. UPDATE A SINGLE BET BY ID
-- Replace the UUID and values as needed
-- ============================================
UPDATE bets
SET 
  date = '2024-01-15',                    -- Change bet date
  sport = 'NBA',                          -- Change sport
  market = 'Player Points',               -- Change market (or NULL)
  selection = 'LeBron James Over 25.5',   -- Change selection
  stake = 50.00,                          -- Change stake amount
  currency = 'USD',                       -- Change currency (AUD, USD, GBP, EUR)
  odds = 1.90,                            -- Change odds
  result = 'win',                         -- Change result (win, loss, void, pending)
  bookmaker = 'DraftKings',                -- Change bookmaker
  updated_at = NOW()                      -- Automatically updated by trigger, but can set explicitly
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 2. UPDATE NBA PROP FIELDS FOR A BET
-- ============================================
UPDATE bets
SET 
  player_id = '12345',                    -- Change player ID
  player_name = 'LeBron James',           -- Change player name
  team = 'Los Angeles Lakers',            -- Change team
  opponent = 'Boston Celtics',            -- Change opponent
  stat_type = 'pts',                      -- Change stat type (pts, reb, ast, stl, blk, fg3m, pr, pra, ra)
  line = 25.5,                            -- Change line
  over_under = 'over',                    -- Change over/under
  game_date = '2024-01-15',               -- Change game date
  status = 'completed',                   -- Change status (pending, live, completed)
  actual_value = 28.0,                    -- Set actual stat value
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 3. UPDATE BET RESULT (win/loss/void/pending)
-- ============================================
UPDATE bets
SET 
  result = 'win',                         -- Change to: 'win', 'loss', 'void', or 'pending'
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 4. BULK UPDATE: Change result for multiple bets by user
-- Replace user email and result as needed
-- ============================================
UPDATE bets
SET 
  result = 'void',                        -- Change result
  updated_at = NOW()
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'user@example.com'  -- Replace with actual email
)
AND result = 'pending';                  -- Only update pending bets

-- ============================================
-- 5. UPDATE PARLAY LEGS (JSONB structure)
-- ============================================
UPDATE bets
SET 
  parlay_legs = '[
    {
      "playerId": "12345",
      "playerName": "LeBron James",
      "team": "Los Angeles Lakers",
      "opponent": "Boston Celtics",
      "gameDate": "2024-01-15",
      "statType": "pts",
      "line": 25.5,
      "overUnder": "over"
    },
    {
      "playerId": "67890",
      "playerName": "Jayson Tatum",
      "team": "Boston Celtics",
      "opponent": "Los Angeles Lakers",
      "gameDate": "2024-01-15",
      "statType": "reb",
      "line": 8.5,
      "overUnder": "over"
    }
  ]'::jsonb,
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 6. UPDATE ACTUAL VALUE AND RESULT FOR NBA PROP
-- Automatically calculates win/loss based on line and actual value
-- ============================================
UPDATE bets
SET 
  actual_value = 28.0,                    -- Set actual stat value
  result = CASE 
    WHEN over_under = 'over' AND 28.0 > line THEN 'win'
    WHEN over_under = 'under' AND 28.0 < line THEN 'win'
    WHEN 28.0 = line THEN 'void'           -- Push = void
    ELSE 'loss'
  END,
  status = 'completed',
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 7. BULK UPDATE: Reset pending bets to a specific status
-- ============================================
UPDATE bets
SET 
  status = 'pending',                     -- Reset status
  result = 'pending',                     -- Reset result
  actual_value = NULL,                    -- Clear actual value
  updated_at = NOW()
WHERE result = 'pending'
  AND status != 'pending';                -- Only update if status differs

-- ============================================
-- 8. UPDATE BOOKMAKER FOR BETS WITHOUT ONE
-- ============================================
UPDATE bets
SET 
  bookmaker = 'DraftKings',               -- Set default bookmaker
  updated_at = NOW()
WHERE bookmaker IS NULL
  AND sport = 'NBA';                      -- Only NBA bets

-- ============================================
-- 9. UPDATE STAKE AND ODDS (for corrections)
-- ============================================
UPDATE bets
SET 
  stake = 100.00,                         -- Correct stake
  odds = 2.50,                            -- Correct odds
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 10. UPDATE MULTIPLE FIELDS AT ONCE
-- ============================================
UPDATE bets
SET 
  date = '2024-01-20',
  stake = 75.00,
  odds = 1.95,
  result = 'win',
  bookmaker = 'FanDuel',
  player_name = 'Stephen Curry',
  stat_type = 'pts',
  line = 30.5,
  over_under = 'over',
  actual_value = 32.0,
  status = 'completed',
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 11. SAFE UPDATE WITH TRANSACTION (TEST FIRST)
-- Run this to test your update before committing
-- ============================================
BEGIN;

-- Your update query here
UPDATE bets
SET result = 'win'
WHERE id = '00000000-0000-0000-0000-000000000000';

-- Check the result
SELECT * FROM bets WHERE id = '00000000-0000-0000-0000-000000000000';

-- If satisfied, run: COMMIT;
-- If not satisfied, run: ROLLBACK;

-- ============================================
-- 12. UPDATE BY DATE RANGE
-- ============================================
UPDATE bets
SET 
  result = 'void',
  updated_at = NOW()
WHERE date >= '2024-01-01'
  AND date <= '2024-01-31'
  AND result = 'pending';

-- ============================================
-- 13. UPDATE ALL BETS FOR A SPECIFIC USER BY EMAIL
-- ============================================
UPDATE bets
SET 
  currency = 'USD',                       -- Change currency for all user's bets
  updated_at = NOW()
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'user@example.com'  -- Replace with actual email
);

-- ============================================
-- 14. VIEW BET BEFORE UPDATING (ALWAYS DO THIS FIRST!)
-- ============================================
SELECT * FROM bets 
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 15. FIND BET ID BY SELECTION TEXT
-- ============================================
SELECT id, date, selection, result, stake, odds
FROM bets
WHERE selection ILIKE '%LeBron James%'    -- Search for text in selection
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 16. UPDATE BET STATUS BASED ON GAME DATE
-- ============================================
UPDATE bets
SET 
  status = CASE 
    WHEN game_date < CURRENT_DATE THEN 'completed'
    WHEN game_date = CURRENT_DATE THEN 'live'
    ELSE 'pending'
  END,
  updated_at = NOW()
WHERE game_date IS NOT NULL
  AND status != CASE 
    WHEN game_date < CURRENT_DATE THEN 'completed'
    WHEN game_date = CURRENT_DATE THEN 'live'
    ELSE 'pending'
  END;

-- ============================================
-- 17. DELETE A BET (USE WITH CAUTION!)
-- ============================================
-- DELETE FROM bets
-- WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- ============================================
-- 18. COPY BET STRUCTURE (Create similar bet)
-- ============================================
-- First, view the bet you want to copy:
-- SELECT * FROM bets WHERE id = 'source-bet-id';

-- Then insert a new bet with modified values:
-- INSERT INTO bets (
--   user_id, date, sport, market, selection, stake, currency, odds, result,
--   player_id, player_name, team, opponent, stat_type, line, over_under, game_date
-- )
-- SELECT 
--   user_id, 
--   date + INTERVAL '1 day',              -- Change date
--   sport, market, selection, stake, currency, odds, 'pending',  -- Reset result
--   player_id, player_name, team, opponent, stat_type, line, over_under, 
--   game_date + INTERVAL '1 day'           -- Change game date
-- FROM bets
-- WHERE id = 'source-bet-id';



