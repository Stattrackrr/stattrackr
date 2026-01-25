-- SQL script to delete all bets for admin@stattrackr.co
-- 
-- Usage: Run this in Supabase SQL Editor
-- WARNING: This will permanently delete all bets for this user!

-- First, find the user_id for admin@stattrackr.co
-- Uncomment the SELECT below to verify the user_id before deleting:
-- SELECT id, email, created_at 
-- FROM auth.users 
-- WHERE email = 'admin@stattrackr.co';

-- Delete all bets for admin@stattrackr.co
-- Replace 'USER_ID_HERE' with the actual user_id from the SELECT above
-- Or use the subquery version below (safer - verifies email matches)

-- OPTION 1: Using subquery (recommended - verifies email)
DELETE FROM bets
WHERE user_id IN (
  SELECT id 
  FROM auth.users 
  WHERE email = 'admin@stattrackr.co'
);

-- OPTION 2: If you already know the user_id, use this instead:
-- DELETE FROM bets
-- WHERE user_id = 'USER_ID_HERE';

-- Verify deletion (run this after to confirm)
-- SELECT COUNT(*) as remaining_bets
-- FROM bets
-- WHERE user_id IN (
--   SELECT id 
--   FROM auth.users 
--   WHERE email = 'admin@stattrackr.co'
-- );
