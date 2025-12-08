-- Quick test script to create a parlay bet for testing leg indicators
-- Run this in Supabase SQL Editor

-- First, let's see if you have any bets today
SELECT 
  id, 
  selection, 
  result, 
  created_at::date as created_date,
  market
FROM bets 
WHERE created_at::date = CURRENT_DATE
ORDER BY created_at DESC
LIMIT 10;

-- If you want to create a test parlay bet, uncomment and run this:
/*
INSERT INTO bets (
  user_id, 
  date, 
  sport, 
  market, 
  selection, 
  stake, 
  currency, 
  odds, 
  result,
  created_at
)
SELECT 
  auth.uid(),
  CURRENT_DATE,
  'NBA',
  'Parlay 2',
  'Parlay: Nikola Jokic over 25.5 Points + LeBron James over 8.5 Assists',
  100,
  'USD',
  3.5,
  'win',  -- Change to 'loss' to test X marks, or 'pending' to test no indicators
  NOW()
WHERE auth.uid() IS NOT NULL
RETURNING id, selection, result, created_at;
*/

-- If you already have a parlay bet from today, you can update its result:
-- Replace 'YOUR_BET_ID' with the actual ID from the first query
/*
UPDATE bets 
SET result = 'win'  -- or 'loss' to see X marks
WHERE id = 'YOUR_BET_ID'
  AND created_at::date = CURRENT_DATE
  AND market LIKE 'parlay%'
RETURNING id, selection, result;
*/




