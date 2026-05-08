ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

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

REVOKE ALL ON FUNCTION public.soft_delete_chat_message(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_chat_message(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_chat_message_pin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_chat_message_pin(UUID) TO authenticated;
