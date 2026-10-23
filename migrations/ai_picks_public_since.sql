-- Public record start date: once ai_picks_settings.public_since is set, the picks page (feed and record)
-- drops picks settled before it, so the public record starts at zero while picks still pending at launch
-- stay up and count once they settle. Older picks stay in the tables for grading, staking and learning
-- (service role), and admin can still read them directly.

ALTER TABLE public.ai_picks_settings ADD COLUMN IF NOT EXISTS public_since TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.ai_picks_viewer_can_read_settled(target_user UUID, settled TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.chat_user_is_admin(target_user)
    OR (
      EXISTS (
        SELECT 1 FROM public.ai_picks_settings s
        WHERE s.id AND s.is_public AND (settled IS NULL OR s.public_since IS NULL OR settled >= s.public_since)
      )
      AND public.chat_user_has_premium_access(target_user)
    );
$$;

GRANT EXECUTE ON FUNCTION public.ai_picks_viewer_can_read_settled(UUID, TIMESTAMPTZ) TO authenticated;

DROP POLICY IF EXISTS "Allowed viewers can read AI picks" ON public.ai_picks;
CREATE POLICY "Allowed viewers can read AI picks"
  ON public.ai_picks FOR SELECT TO authenticated
  USING (public.ai_picks_viewer_can_read_settled(auth.uid(), settled_at));

-- A leg is readable exactly when its pick is (the subquery runs under the ai_picks policy above).
DROP POLICY IF EXISTS "Allowed viewers can read AI pick legs" ON public.ai_pick_legs;
CREATE POLICY "Allowed viewers can read AI pick legs"
  ON public.ai_pick_legs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_picks p WHERE p.id = ai_pick_legs.pick_id));

-- Go public with a fresh record:
--   UPDATE public.ai_picks_settings SET is_public = TRUE, public_since = NOW() WHERE id;
