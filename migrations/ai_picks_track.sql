-- Test arms: picks from a second set of betting rules, posted beside the live picks for admin only.
-- `track` is NULL for the live picks members see and names the arm otherwise (e.g. 'punter-v1').
-- The column and the read rule go in together: the poster writes `track`, so until this file has
-- been run an arm's pick cannot be stored at all, and afterwards only admin can read it.
--
-- Legs need no change: a leg is readable exactly when its pick is (see ai_picks_public_since.sql).

BEGIN;

ALTER TABLE public.ai_picks ADD COLUMN IF NOT EXISTS track TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_picks_track_posted ON public.ai_picks (track, posted_at DESC) WHERE track IS NOT NULL;

DROP POLICY IF EXISTS "Allowed viewers can read AI picks" ON public.ai_picks;
CREATE POLICY "Allowed viewers can read AI picks"
  ON public.ai_picks FOR SELECT TO authenticated
  USING (
    CASE
      WHEN track IS NULL THEN public.ai_picks_viewer_can_read_settled(auth.uid(), settled_at)
      ELSE public.chat_user_is_admin(auth.uid())
    END
  );

COMMIT;

-- Check afterwards (as a premium member this must return 0, as admin the arm's picks):
--   SELECT count(*) FROM public.ai_picks WHERE track IS NOT NULL;
