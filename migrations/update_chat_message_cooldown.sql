CREATE OR REPLACE FUNCTION public.prepare_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_profile public.profiles%ROWTYPE;
  target_room public.chat_rooms%ROWTYPE;
  recent_message_count_5s INTEGER;
  recent_message_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;

  IF NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only send messages as yourself';
  END IF;

  SELECT *
  INTO sender_profile
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT *
  INTO target_room
  FROM public.chat_rooms
  WHERE id = NEW.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat room not found';
  END IF;

  NEW.body := btrim(regexp_replace(COALESCE(NEW.body, ''), '\s+', ' ', 'g'));

  IF NEW.body = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF char_length(NEW.body) > 500 THEN
    RAISE EXCEPTION 'Message cannot exceed 500 characters';
  END IF;

  IF target_room.is_premium AND NOT public.chat_user_has_premium_access(NEW.user_id) THEN
    RAISE EXCEPTION 'Premium chat requires an active premium subscription';
  END IF;

  SELECT COUNT(*)
  INTO recent_message_count_5s
  FROM public.chat_messages
  WHERE user_id = NEW.user_id
    AND created_at > NOW() - INTERVAL '5 seconds';

  IF recent_message_count_5s >= 3 THEN
    RAISE EXCEPTION 'Message cooldown, wait 5 seconds';
  END IF;

  SELECT COUNT(*)
  INTO recent_message_count
  FROM public.chat_messages
  WHERE user_id = NEW.user_id
    AND created_at > NOW() - INTERVAL '30 seconds';

  IF recent_message_count >= 6 THEN
    RAISE EXCEPTION 'You are sending messages too quickly';
  END IF;

  NEW.display_name := COALESCE(
    NULLIF(sender_profile.username, ''),
    NULLIF(sender_profile.full_name, ''),
    NULLIF(split_part(COALESCE(sender_profile.email, ''), '@', 1), ''),
    'Member'
  );
  NEW.avatar_url := NULLIF(sender_profile.avatar_url, '');
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$;
