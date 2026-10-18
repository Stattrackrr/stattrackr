-- Web push: one row per browser/device that turned on alerts. Written by /api/push/subscribe
-- (service role) so a device that changes account moves to the new user instead of failing RLS.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  picks BOOLEAN NOT NULL DEFAULT TRUE,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can read own push subscriptions"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Devices that should get a new-pick alert: same rule as reading picks (admin, or premium once public).
CREATE OR REPLACE FUNCTION public.push_pick_recipients()
RETURNS TABLE (id UUID, endpoint TEXT, p256dh TEXT, auth TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.endpoint, s.p256dh, s.auth
  FROM public.push_subscriptions s
  WHERE s.picks
    AND public.ai_picks_viewer_can_read(s.user_id);
$$;

REVOKE ALL ON FUNCTION public.push_pick_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_pick_recipients() TO service_role;
