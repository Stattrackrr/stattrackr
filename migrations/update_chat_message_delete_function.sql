CREATE OR REPLACE FUNCTION public.soft_delete_chat_message(target_message_id UUID)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_message public.chat_messages%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.chat_messages
  SET
    deleted_at = NOW(),
    deleted_by = auth.uid(),
    updated_at = NOW()
  WHERE id = target_message_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL
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
