-- ============================================
-- DELETE ALL BETS FOR admin@stattrackr.co
-- Run in Supabase SQL Editor. Use with caution.
-- ============================================

DO $$
DECLARE
  target_user_id UUID;
  deleted_count INT;
BEGIN
  SELECT id INTO target_user_id FROM auth.users WHERE email = 'admin@stattrackr.co' LIMIT 1;
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email admin@stattrackr.co.';
  END IF;

  DELETE FROM bets WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Deleted % bet(s) for admin@stattrackr.co.', deleted_count;
END $$;
