-- Picks a member has marked "Added" (they have the bet on). Only a marker on their own cards: the record,
-- grading and learning never read it. Removing a pick removes its marks.

CREATE TABLE IF NOT EXISTS public.ai_pick_added (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pick_id UUID NOT NULL REFERENCES public.ai_picks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, pick_id)
);

CREATE INDEX IF NOT EXISTS ai_pick_added_pick_id_idx ON public.ai_pick_added (pick_id);

ALTER TABLE public.ai_pick_added ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their added picks" ON public.ai_pick_added;
CREATE POLICY "Members read their added picks"
  ON public.ai_pick_added FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Members add picks" ON public.ai_pick_added;
CREATE POLICY "Members add picks"
  ON public.ai_pick_added FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Members remove their added picks" ON public.ai_pick_added;
CREATE POLICY "Members remove their added picks"
  ON public.ai_pick_added FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.ai_pick_added TO authenticated;
