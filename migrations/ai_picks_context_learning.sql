-- AI picks: let the nightly learning loop tune how hard game context (matchups, pace, injuries,
-- Elo, rankings, fatigue) moves the model. Each watched play stores the model's probability with
-- context switched off and at full strength. Safe to run more than once.

ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS base_model_prob NUMERIC(6, 4);  -- context off
ALTER TABLE public.ai_pick_watchlist ADD COLUMN IF NOT EXISTS full_model_prob NUMERIC(6, 4);  -- context at full strength
