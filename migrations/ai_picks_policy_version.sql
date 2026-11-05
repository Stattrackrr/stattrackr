-- The rule set each AI picks watchlist row was made under (lib/aiPicks/params.ts AI_POLICY_VERSIONS).
-- Evaluations select by version, never by date. Run this before deploying the code that writes it:
-- existing tennis rows are marked as made under the old rules.

ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS policy_version TEXT;

UPDATE public.ai_pick_watchlist SET policy_version = 'tennis-legacy' WHERE sport = 'tennis' AND policy_version IS NULL;

UPDATE public.ai_picks
SET context = COALESCE(context, '{}'::jsonb) || jsonb_build_object('policy_version', 'tennis-legacy')
WHERE sport = 'tennis' AND NOT (COALESCE(context, '{}'::jsonb) ? 'policy_version');

CREATE INDEX IF NOT EXISTS ai_pick_watchlist_policy_version_idx ON public.ai_pick_watchlist (sport, policy_version);
