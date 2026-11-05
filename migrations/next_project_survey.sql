-- "We want your say" survey on the props page: what to build next while the betting AI collects data.
-- One row per user (re-submitting updates it). Written only by the API with the service role.
-- Rollback: DROP TABLE IF EXISTS public.next_project_survey_votes;
BEGIN;
CREATE TABLE IF NOT EXISTS public.next_project_survey_votes (
  user_id UUID PRIMARY KEY,
  user_email TEXT,
  choices TEXT[] NOT NULL,
  sport_request TEXT,
  comment TEXT,
  source_page TEXT NOT NULL DEFAULT 'props',
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.next_project_survey_votes ENABLE ROW LEVEL SECURITY;
COMMIT;
NOTIFY pgrst, 'reload schema';
