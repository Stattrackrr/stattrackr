-- Tools arb threshold alerts: opt-in flag + min ROI % on each device subscription.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS tools_arb BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tools_arb_min_pct NUMERIC NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.push_subscriptions.tools_arb IS 'When true, device gets Tools arb push when ROI >= tools_arb_min_pct';
COMMENT ON COLUMN public.push_subscriptions.tools_arb_min_pct IS 'User-facing percent threshold (2 = 2% ROI)';

-- Devices that should get a Tools arb alert: opted in and Pro (or site admin).
CREATE OR REPLACE FUNCTION public.push_tools_arb_recipients()
RETURNS TABLE (id UUID, endpoint TEXT, p256dh TEXT, auth TEXT, tools_arb_min_pct NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.endpoint, s.p256dh, s.auth, s.tools_arb_min_pct
  FROM public.push_subscriptions s
  WHERE s.tools_arb
    AND (
      public.chat_user_has_premium_access(s.user_id)
      OR public.chat_user_is_admin(s.user_id)
    );
$$;

REVOKE ALL ON FUNCTION public.push_tools_arb_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_tools_arb_recipients() TO service_role;
