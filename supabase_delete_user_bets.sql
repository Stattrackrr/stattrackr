-- ============================================
-- DELETE USER BETS FROM SUPABASE
-- Run these queries in Supabase SQL Editor
-- ============================================

-- IMPORTANT: These queries bypass RLS (Row Level Security)
-- Only run these if you have admin access to Supabase

-- ============================================
-- OPTION 1: Delete all bets for a specific user by user_id
-- ============================================
-- Replace 'USER_ID_HERE' with the actual user UUID
-- You can find user IDs in the auth.users table

DELETE FROM bets 
WHERE user_id = 'USER_ID_HERE';

-- Example:
-- DELETE FROM bets WHERE user_id = '123e4567-e89b-12d3-a456-426614174000';

-- ============================================
-- OPTION 2: Delete bets for a user by email
-- ============================================
-- This finds the user_id from their email and deletes their bets

DELETE FROM bets 
WHERE user_id IN (
  SELECT id 
  FROM auth.users 
  WHERE email = 'user@example.com'
);

-- ============================================
-- OPTION 3: Delete specific bet by bet ID
-- ============================================
-- Replace 'BET_ID_HERE' with the actual bet UUID

DELETE FROM bets 
WHERE id = 'BET_ID_HERE';

-- ============================================
-- OPTION 4: Delete bets matching specific criteria
-- ============================================

-- Delete all bets for a user on a specific date
DELETE FROM bets 
WHERE user_id = 'USER_ID_HERE' 
  AND date = '2024-01-15';

-- Delete all pending bets for a user
DELETE FROM bets 
WHERE user_id = 'USER_ID_HERE' 
  AND result = 'pending';

-- Delete all bets for a user in a date range
DELETE FROM bets 
WHERE user_id = 'USER_ID_HERE' 
  AND date >= '2024-01-01' 
  AND date <= '2024-01-31';

-- Delete all bets for a user with a specific sport
DELETE FROM bets 
WHERE user_id = 'USER_ID_HERE' 
  AND sport = 'NBA';

-- ============================================
-- OPTION 5: View bets before deleting (SAFETY CHECK)
-- ============================================
-- Always check what you're about to delete first!

-- View all bets for a specific user
SELECT * FROM bets 
WHERE user_id = 'USER_ID_HERE' 
ORDER BY date DESC;

-- View bets for a user by email
SELECT b.*, u.email 
FROM bets b
JOIN auth.users u ON b.user_id = u.id
WHERE u.email = 'user@example.com'
ORDER BY b.date DESC;

-- Count bets for a user
SELECT COUNT(*) as bet_count 
FROM bets 
WHERE user_id = 'USER_ID_HERE';

-- ============================================
-- OPTION 6: Find user_id from email or other info
-- ============================================

-- Find user_id by email
SELECT id, email, created_at 
FROM auth.users 
WHERE email = 'user@example.com';

-- List all users with their bet counts
SELECT 
  u.id,
  u.email,
  u.created_at as user_created_at,
  COUNT(b.id) as bet_count,
  SUM(b.stake) as total_staked
FROM auth.users u
LEFT JOIN bets b ON u.id = b.user_id
GROUP BY u.id, u.email, u.created_at
ORDER BY bet_count DESC;

-- ============================================
-- OPTION 7: Delete bets for multiple users
-- ============================================

-- Delete bets for multiple specific user IDs
DELETE FROM bets 
WHERE user_id IN (
  'USER_ID_1',
  'USER_ID_2',
  'USER_ID_3'
);

-- Delete bets for users matching a pattern (e.g., test accounts)
DELETE FROM bets 
WHERE user_id IN (
  SELECT id 
  FROM auth.users 
  WHERE email LIKE '%test%' 
     OR email LIKE '%example%'
);

-- ============================================
-- SAFETY TIPS:
-- ============================================
-- 1. Always run SELECT queries first to see what will be deleted
-- 2. Consider backing up data before bulk deletions
-- 3. Use transactions to test deletions:
--    BEGIN;
--    DELETE FROM bets WHERE user_id = 'USER_ID_HERE';
--    -- Check the result
--    ROLLBACK; -- or COMMIT; if satisfied
-- 4. Be careful with date ranges - check your timezone settings
-- 5. Double-check user_id values before running DELETE









