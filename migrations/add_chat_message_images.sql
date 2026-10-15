-- Photos in chat, admin only (admin@stattrackr.co via public.chat_user_is_admin).
-- Images live in the public "chat-images" bucket; chat_messages.image_url points at them.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS image_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-images', 'chat-images', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Admin can upload chat images" ON storage.objects;
CREATE POLICY "Admin can upload chat images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-images'
  AND public.chat_user_is_admin(auth.uid())
);

DROP POLICY IF EXISTS "Admin can delete chat images" ON storage.objects;
CREATE POLICY "Admin can delete chat images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'chat-images'
  AND public.chat_user_is_admin(auth.uid())
);

DROP POLICY IF EXISTS "Public read chat images" ON storage.objects;
CREATE POLICY "Public read chat images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'chat-images');

-- Same as update_chat_message_cooldown.sql, plus image_url: admin only, must be a chat-images
-- object, and a photo may be sent without text.
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

  NEW.body := btrim(COALESCE(NEW.body, ''));
  NEW.image_url := NULLIF(btrim(COALESCE(NEW.image_url, '')), '');

  IF NEW.image_url IS NOT NULL THEN
    IF NOT public.chat_user_is_admin(NEW.user_id) THEN
      RAISE EXCEPTION 'Only admins can post photos';
    END IF;

    IF NEW.image_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/chat-images/' THEN
      RAISE EXCEPTION 'Invalid photo';
    END IF;
  END IF;

  IF NEW.body = '' AND NEW.image_url IS NULL THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF char_length(NEW.body) > 1500 THEN
    RAISE EXCEPTION 'Message cannot exceed 1500 characters';
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
