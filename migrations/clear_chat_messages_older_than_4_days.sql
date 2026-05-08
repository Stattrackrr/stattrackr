-- ============================================
-- CLEAR CHAT MESSAGES OLDER THAN 4 DAYS
-- Run in Supabase SQL Editor. Use with caution.
-- This deletes messages older than 4 days from public.chat_messages.
-- ============================================

DO $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM public.chat_messages
  WHERE created_at < NOW() - INTERVAL '4 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Deleted % chat message(s) older than 4 days.', deleted_count;
END $$;
