-- AI picks learning: grade every play the AI watched (posted or not) so the nightly learning loop
-- has far more results to study than the posted picks alone. Run after create_ai_picks.sql.

ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS event_label TEXT;
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS market_kind TEXT;
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS player_id TEXT;
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS team TEXT;
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS raw_model_prob NUMERIC(6, 4);  -- model alone
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS market_prob NUMERIC(6, 4);     -- de-vigged market
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS push_prob NUMERIC(6, 4);
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS result_status TEXT
  CHECK (result_status IN ('win', 'loss', 'push', 'void'));
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS result_value NUMERIC(10, 2);
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ai_pick_watchlist_ungraded
  ON public.ai_pick_watchlist (starts_at) WHERE graded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_pick_watchlist_graded
  ON public.ai_pick_watchlist (sport, graded_at DESC) WHERE graded_at IS NOT NULL;
