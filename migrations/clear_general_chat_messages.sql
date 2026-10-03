-- ============================================
-- CLEAR COMMUNITY (GENERAL) CHAT MESSAGES
-- Run in Supabase SQL Editor. Use with caution.
-- This deletes messages from the general room only.
-- ============================================

DO $$
DECLARE
  deleted_count INT;
  general_room_id UUID;
BEGIN
  SELECT id INTO general_room_id
  FROM public.chat_rooms
  WHERE slug = 'general';

  IF general_room_id IS NULL THEN
    RAISE EXCEPTION 'Chat room "general" not found.';
  END IF;

  DELETE FROM public.chat_messages
  WHERE room_id = general_room_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RAISE NOTICE 'Deleted % community chat message(s).', deleted_count;
END $$;
