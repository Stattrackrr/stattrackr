-- ============================================
-- GENERATE MOCK CHAT MESSAGES
-- Run in Supabase SQL Editor
--
-- Notes:
-- - chat_messages.user_id must reference a real profile/auth user
-- - this script uses one existing profile row only as an internal FK anchor
-- - visible chat names are overwritten to mock names after insert
-- ============================================

DO $$
DECLARE
  anchor_user_id UUID;
  general_room_id UUID;

  msg_old_1 UUID := gen_random_uuid();
  msg_old_2 UUID := gen_random_uuid();
  msg_yesterday_1 UUID := gen_random_uuid();
  msg_yesterday_2 UUID := gen_random_uuid();
  msg_today_1 UUID := gen_random_uuid();
  msg_today_2 UUID := gen_random_uuid();
BEGIN
  SELECT id
  INTO anchor_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1;

  IF anchor_user_id IS NULL THEN
    RAISE EXCEPTION 'No profile rows found. Create at least one user account first.';
  END IF;

  SELECT id
  INTO general_room_id
  FROM public.chat_rooms
  WHERE slug = 'general'
  LIMIT 1;

  IF general_room_id IS NULL THEN
    RAISE EXCEPTION 'Chat room "general" not found. Run create_chat_rooms_and_messages.sql first.';
  END IF;

  -- Bypass the authenticated-user insert trigger for SQL-editor mock data.
  ALTER TABLE public.chat_messages DISABLE TRIGGER prepare_chat_message_before_insert;

  INSERT INTO public.chat_messages (
    id,
    room_id,
    user_id,
    body,
    display_name,
    avatar_url,
    created_at,
    updated_at,
    reply_to_message_id
  )
  VALUES
    (
      msg_old_1,
      general_room_id,
      anchor_user_id,
      'Mock message from a few days ago.',
      'mockcapper',
      NULL,
      NOW() - INTERVAL '5 days',
      NOW() - INTERVAL '5 days',
      NULL
    ),
    (
      msg_old_2,
      general_room_id,
      anchor_user_id,
      'Old reply so you can test date dividers and reply previews.',
      'valuehunter',
      NULL,
      NOW() - INTERVAL '5 days' + INTERVAL '8 minutes',
      NOW() - INTERVAL '5 days' + INTERVAL '8 minutes',
      msg_old_1
    ),
    (
      msg_yesterday_1,
      general_room_id,
      anchor_user_id,
      'Message from yesterday for timeline grouping.',
      'slipgod',
      NULL,
      NOW() - INTERVAL '1 day' - INTERVAL '20 minutes',
      NOW() - INTERVAL '1 day' - INTERVAL '20 minutes',
      NULL
    ),
    (
      msg_yesterday_2,
      general_room_id,
      anchor_user_id,
      'Another yesterday message to make the separator obvious.',
      'linewatcher',
      NULL,
      NOW() - INTERVAL '1 day' - INTERVAL '10 minutes',
      NOW() - INTERVAL '1 day' - INTERVAL '10 minutes',
      NULL
    ),
    (
      msg_today_1,
      general_room_id,
      anchor_user_id,
      'Mock message from today.',
      'bankrolltalk',
      NULL,
      NOW() - INTERVAL '30 minutes',
      NOW() - INTERVAL '30 minutes',
      NULL
    ),
    (
      msg_today_2,
      general_room_id,
      anchor_user_id,
      'Mock reply from today to test hover reply UI.',
      'oddsfinder',
      NULL,
      NOW() - INTERVAL '22 minutes',
      NOW() - INTERVAL '22 minutes',
      msg_today_1
    );

  ALTER TABLE public.chat_messages ENABLE TRIGGER prepare_chat_message_before_insert;

  RAISE NOTICE 'Inserted 6 mock chat messages into Community Chat.';
EXCEPTION
  WHEN OTHERS THEN
    ALTER TABLE public.chat_messages ENABLE TRIGGER prepare_chat_message_before_insert;
    RAISE;
END $$;
