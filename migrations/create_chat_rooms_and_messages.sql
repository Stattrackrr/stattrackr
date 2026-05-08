CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Member',
  avatar_url TEXT,
  reply_to_message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  pinned_at TIMESTAMPTZ,
  pinned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created_at
  ON public.chat_messages(room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created_at
  ON public.chat_messages(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_pinned_at
  ON public.chat_messages(room_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.chat_user_has_premium_access(target_user UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    lower(COALESCE(auth.jwt() ->> 'email', '')) = 'admin@stattrackr.co'
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = COALESCE(target_user, auth.uid())
        AND (
          lower(COALESCE(email, '')) = 'admin@stattrackr.co'
          OR (
            subscription_status IN ('active', 'trialing')
            AND subscription_tier IN ('premium', 'pro')
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.chat_user_is_admin(target_user UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lower(COALESCE(auth.jwt() ->> 'email', '')) = 'admin@stattrackr.co'
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = COALESCE(target_user, auth.uid())
        AND lower(COALESCE(email, '')) = 'admin@stattrackr.co'
    );
$$;

CREATE OR REPLACE FUNCTION public.touch_chat_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_chat_message(target_message_id UUID)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_message public.chat_messages%ROWTYPE;
  is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT public.chat_user_is_admin(auth.uid()) INTO is_admin;

  UPDATE public.chat_messages
  SET
    deleted_at = NOW(),
    deleted_by = auth.uid(),
    pinned_at = NULL,
    pinned_by = NULL,
    updated_at = NOW()
  WHERE id = target_message_id
    AND deleted_at IS NULL
    AND (user_id = auth.uid() OR is_admin)
  RETURNING *
  INTO deleted_message;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or cannot be deleted';
  END IF;

  RETURN deleted_message;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_chat_message(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_chat_message(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_chat_message_pin(target_message_id UUID)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pinned_message public.chat_messages%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.chat_user_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE public.chat_messages
  SET
    pinned_at = CASE WHEN pinned_at IS NULL THEN NOW() ELSE NULL END,
    pinned_by = CASE WHEN pinned_at IS NULL THEN auth.uid() ELSE NULL END,
    updated_at = NOW()
  WHERE id = target_message_id
    AND deleted_at IS NULL
  RETURNING *
  INTO pinned_message;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or cannot be pinned';
  END IF;

  RETURN pinned_message;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_user_is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_user_is_admin(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_chat_message_pin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_chat_message_pin(UUID) TO authenticated;

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

DROP TRIGGER IF EXISTS chat_rooms_touch_updated_at ON public.chat_rooms;
CREATE TRIGGER chat_rooms_touch_updated_at
  BEFORE UPDATE ON public.chat_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_chat_updated_at();

DROP TRIGGER IF EXISTS chat_messages_touch_updated_at ON public.chat_messages;
CREATE TRIGGER chat_messages_touch_updated_at
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_chat_updated_at();

DROP TRIGGER IF EXISTS prepare_chat_message_before_insert ON public.chat_messages;
CREATE TRIGGER prepare_chat_message_before_insert
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_chat_message();

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Premium users can read chat rooms" ON public.chat_rooms;
CREATE POLICY "Premium users can read chat rooms"
  ON public.chat_rooms
  FOR SELECT
  TO authenticated
  USING ((NOT is_premium) OR public.chat_user_has_premium_access(auth.uid()));

DROP POLICY IF EXISTS "Premium users can read chat messages" ON public.chat_messages;
CREATE POLICY "Premium users can read chat messages"
  ON public.chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_rooms
      WHERE chat_rooms.id = chat_messages.room_id
        AND ((NOT chat_rooms.is_premium) OR public.chat_user_has_premium_access(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Premium users can insert chat messages" ON public.chat_messages;
CREATE POLICY "Premium users can insert chat messages"
  ON public.chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.chat_rooms
      WHERE chat_rooms.id = chat_messages.room_id
        AND ((NOT chat_rooms.is_premium) OR public.chat_user_has_premium_access(auth.uid()))
    )
  );

INSERT INTO public.chat_rooms (slug, name, description, is_premium)
VALUES
  ('general', 'General', 'Talk shop, discuss slates, and hang out with the community.', true),
  ('picks', 'Picks', 'Share what you are playing today and compare notes with other members.', true)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_premium = EXCLUDED.is_premium,
  updated_at = NOW();

UPDATE public.chat_messages AS chat_messages
SET display_name = COALESCE(
  NULLIF(profiles.username, ''),
  NULLIF(profiles.full_name, ''),
  NULLIF(split_part(COALESCE(profiles.email, ''), '@', 1), ''),
  chat_messages.display_name,
  'Member'
)
FROM public.profiles
WHERE profiles.id = chat_messages.user_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END;
$$;
