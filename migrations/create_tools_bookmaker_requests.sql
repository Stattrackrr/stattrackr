-- Bookmaker add-requests from Tools / Bonus Flipper.
-- Written and read only via /api/tools/bookmaker-request (service role).
-- Rollback: DROP TABLE IF EXISTS public.tools_bookmaker_requests;

BEGIN;

CREATE TABLE IF NOT EXISTS public.tools_bookmaker_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  user_email text,
  bookmaker_name text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tools_bookmaker_requests_created_at_idx
  ON public.tools_bookmaker_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS tools_bookmaker_requests_status_idx
  ON public.tools_bookmaker_requests (status);

ALTER TABLE public.tools_bookmaker_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tools_bookmaker_requests FROM anon;
REVOKE ALL ON public.tools_bookmaker_requests FROM authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
