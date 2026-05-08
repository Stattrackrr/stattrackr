-- ============================================
-- CLEAR ALL CHAT MESSAGES
-- Run in Supabase SQL Editor. Use with caution.
-- This deletes every message from public.chat_messages.
-- ============================================

DO $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM public.chat_messages;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Deleted % chat message(s).', deleted_count;
END $$;
