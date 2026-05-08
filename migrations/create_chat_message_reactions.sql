CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_message_reactions_unique UNIQUE (message_id, user_id, emoji),
  CONSTRAINT chat_message_reactions_emoji_length CHECK (char_length(emoji) BETWEEN 1 AND 16)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message_id
  ON public.chat_message_reactions(message_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_user_id
  ON public.chat_message_reactions(user_id, created_at DESC);

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Premium users can read chat reactions" ON public.chat_message_reactions;
CREATE POLICY "Premium users can read chat reactions"
  ON public.chat_message_reactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_messages
      JOIN public.chat_rooms ON public.chat_rooms.id = public.chat_messages.room_id
      WHERE public.chat_messages.id = chat_message_reactions.message_id
        AND public.chat_messages.deleted_at IS NULL
        AND ((NOT public.chat_rooms.is_premium) OR public.chat_user_has_premium_access(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Premium users can insert own chat reactions" ON public.chat_message_reactions;
CREATE POLICY "Premium users can insert own chat reactions"
  ON public.chat_message_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.chat_messages
      JOIN public.chat_rooms ON public.chat_rooms.id = public.chat_messages.room_id
      WHERE public.chat_messages.id = chat_message_reactions.message_id
        AND public.chat_messages.deleted_at IS NULL
        AND ((NOT public.chat_rooms.is_premium) OR public.chat_user_has_premium_access(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Premium users can delete own chat reactions" ON public.chat_message_reactions;
CREATE POLICY "Premium users can delete own chat reactions"
  ON public.chat_message_reactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reactions;
  END IF;
END;
$$;
