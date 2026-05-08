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
