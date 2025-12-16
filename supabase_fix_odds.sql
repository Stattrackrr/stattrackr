-- ============================================
-- FIX BET ODDS - Simple Script
-- ============================================

-- 1. UPDATE ODDS FOR A SPECIFIC BET BY ID
-- Replace the UUID and odds value
UPDATE bets
SET 
  odds = 2.50,                            -- Change to correct odds
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with actual bet ID

-- 2. FIND BET ID BY SELECTION TEXT (use this first to find the bet)
SELECT 
  id,
  date,
  selection,
  odds,                                    -- Current odds
  stake,
  result
FROM bets
WHERE selection ILIKE '%search_text%'     -- Replace 'search_text' with part of the bet description
ORDER BY created_at DESC;

-- 3. UPDATE ODDS FOR MULTIPLE BETS (by date range)
UPDATE bets
SET 
  odds = 1.90,                            -- New odds value
  updated_at = NOW()
WHERE date >= '2024-01-01'                -- Start date
  AND date <= '2024-01-31'                -- End date
  AND odds != 1.90;                       -- Only update if different

-- 4. UPDATE ODDS FOR A SPECIFIC USER'S BETS
UPDATE bets
SET 
  odds = 2.00,                            -- New odds value
  updated_at = NOW()
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'user@example.com'  -- Replace with email
)
AND date = '2024-01-15';                  -- Optional: specific date

-- 5. VIEW BET BEFORE UPDATING (ALWAYS CHECK FIRST!)
SELECT 
  id,
  date,
  selection,
  odds,                                    -- Current odds
  stake,
  currency,
  result
FROM bets 
WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with bet ID

-- 6. SAFE UPDATE WITH TRANSACTION (TEST FIRST)
BEGIN;

-- Update the odds
UPDATE bets
SET odds = 2.50
WHERE id = '00000000-0000-0000-0000-000000000000';

-- Check the result
SELECT id, selection, odds FROM bets WHERE id = '00000000-0000-0000-0000-000000000000';

-- If satisfied: COMMIT;
-- If not: ROLLBACK;




















