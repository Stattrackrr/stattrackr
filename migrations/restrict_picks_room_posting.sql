UPDATE public.chat_rooms
SET
  name = 'Picks',
  description = 'Official StatTrackr picks. Members can react to every play.',
  updated_at = NOW()
WHERE slug = 'picks';

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
        AND (chat_rooms.slug <> 'picks' OR public.chat_user_is_admin(auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.edit_chat_message(target_message_id UUID, next_body TEXT)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  edited_message public.chat_messages%ROWTYPE;
  cleaned_body TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  cleaned_body := btrim(COALESCE(next_body, ''));

  IF cleaned_body = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF char_length(cleaned_body) > 1500 THEN
    RAISE EXCEPTION 'Message cannot exceed 1500 characters';
  END IF;

  UPDATE public.chat_messages
  SET
    body = cleaned_body,
    edited_at = NOW(),
    updated_at = NOW()
  WHERE id = target_message_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.chat_rooms
      WHERE chat_rooms.id = chat_messages.room_id
        AND (chat_rooms.slug <> 'picks' OR public.chat_user_is_admin(auth.uid()))
    )
  RETURNING *
  INTO edited_message;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or cannot be edited';
  END IF;

  RETURN edited_message;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_chat_message(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_chat_message(UUID, TEXT) TO authenticated;
