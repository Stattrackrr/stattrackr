-- AI picks: automated picks posted by "Stattrackr AI", graded and learned from automatically.
-- Writes come only from the server (service role bypasses RLS). Reads:
--   * admin@stattrackr.co always
--   * premium members only once ai_picks_settings.is_public = true
-- Watchlist, learning state and run logs are admin-only forever.

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_picks_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.ai_picks_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ai_picks_viewer_can_read(target_user UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.chat_user_is_admin(target_user)
    OR (
      COALESCE((SELECT is_public FROM public.ai_picks_settings WHERE id), FALSE)
      AND public.chat_user_has_premium_access(target_user)
    );
$$;

GRANT EXECUTE ON FUNCTION public.ai_picks_viewer_can_read(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Picks (a single or a 2-leg multi)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('single', 'multi')),
  sport TEXT NOT NULL,                       -- 'nbl' | 'tennis' | ... ; 'mixed' for a cross-sport multi
  title TEXT NOT NULL,                       -- e.g. "Xavier Cooks over 15.5 points"
  write_up TEXT,                             -- the AI's reasoning shown on the card
  units NUMERIC(3, 1) NOT NULL CHECK (units IN (0.5, 1, 1.5, 2, 2.5, 3)),
  price NUMERIC(10, 3) NOT NULL CHECK (price >= 1.65),
  bookmaker TEXT NOT NULL,
  model_prob NUMERIC(6, 4),                  -- AI probability the pick wins (multi: combined)
  ev NUMERIC(8, 4),                          -- model_prob * price - 1
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'win', 'loss', 'push', 'void')),
  profit_units NUMERIC(8, 3),                -- set when settled
  first_starts_at TIMESTAMPTZ NOT NULL,      -- earliest leg start
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  model_version TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb, -- stats snapshot behind the pick, for the AI to study later
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_picks_posted_at ON public.ai_picks (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_picks_status ON public.ai_picks (status);
CREATE INDEX IF NOT EXISTS idx_ai_picks_sport_posted ON public.ai_picks (sport, posted_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_pick_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id UUID NOT NULL REFERENCES public.ai_picks(id) ON DELETE CASCADE,
  leg_index SMALLINT NOT NULL DEFAULT 0,
  sport TEXT NOT NULL,
  event_key TEXT NOT NULL,                   -- NBL gameKey / tennis matchId
  event_label TEXT NOT NULL,                 -- "New Zealand Breakers @ Sydney Kings"
  starts_at TIMESTAMPTZ NOT NULL,
  market TEXT NOT NULL,                      -- 'points', 'match_winner', 'total_games', ...
  market_kind TEXT NOT NULL DEFAULT 'main',  -- 'main' | 'alternate' | 'milestone'
  player TEXT,
  player_id TEXT,
  team TEXT,
  side TEXT NOT NULL,                        -- 'over' | 'under' | 'home' | 'away' | 'yes' | 'no'
  line NUMERIC(8, 2),
  price NUMERIC(10, 3) NOT NULL CHECK (price > 1),
  bookmaker TEXT NOT NULL,
  model_prob NUMERIC(6, 4),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'win', 'loss', 'push', 'void')),
  result_value NUMERIC(10, 2),               -- the actual stat / margin used to grade
  result_note TEXT,
  closing_line NUMERIC(8, 2),
  closing_price NUMERIC(10, 3),
  graded_at TIMESTAMPTZ,
  UNIQUE (pick_id, leg_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_pick_legs_pick ON public.ai_pick_legs (pick_id);
CREATE INDEX IF NOT EXISTS idx_ai_pick_legs_pending ON public.ai_pick_legs (status, starts_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Watchlist: candidates the AI is tracking before deciding to post
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_pick_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_key TEXT NOT NULL UNIQUE,        -- sport|event|market|player|side|line
  sport TEXT NOT NULL,
  event_key TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  market TEXT NOT NULL,
  player TEXT,
  side TEXT NOT NULL,
  line NUMERIC(8, 2),
  best_price NUMERIC(10, 3),
  bookmaker TEXT,
  model_prob NUMERIC(6, 4),
  ev NUMERIC(8, 4),
  score NUMERIC(8, 4),
  status TEXT NOT NULL DEFAULT 'watching' CHECK (status IN ('watching', 'posted', 'dropped', 'expired')),
  reason TEXT,
  history JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{at, price, line, prob, ev, score}]
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_pick_watchlist_active ON public.ai_pick_watchlist (sport, starts_at) WHERE status = 'watching';

-- ---------------------------------------------------------------------------
-- Learning state: versioned calibration/weights per sport (rollback = activate an older version)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_learning_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sport, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_learning_state_one_active
  ON public.ai_learning_state (sport) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Run log: every scan / grade / learn run, including AI token use
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_pick_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('scan', 'grade', 'learn')),
  sport TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  considered INTEGER NOT NULL DEFAULT 0,
  posted INTEGER NOT NULL DEFAULT 0,
  graded INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_pick_runs_started ON public.ai_pick_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_ai_picks_updated_at ON public.ai_picks;
CREATE TRIGGER update_ai_picks_updated_at
  BEFORE UPDATE ON public.ai_picks
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_picks_settings_updated_at ON public.ai_picks_settings;
CREATE TRIGGER update_ai_picks_settings_updated_at
  BEFORE UPDATE ON public.ai_picks_settings
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS (no insert/update/delete policies: only the service role writes)
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_picks_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pick_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pick_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_learning_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_pick_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can read AI picks settings" ON public.ai_picks_settings;
CREATE POLICY "Signed-in users can read AI picks settings"
  ON public.ai_picks_settings FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Allowed viewers can read AI picks" ON public.ai_picks;
CREATE POLICY "Allowed viewers can read AI picks"
  ON public.ai_picks FOR SELECT TO authenticated
  USING (public.ai_picks_viewer_can_read(auth.uid()));

DROP POLICY IF EXISTS "Allowed viewers can read AI pick legs" ON public.ai_pick_legs;
CREATE POLICY "Allowed viewers can read AI pick legs"
  ON public.ai_pick_legs FOR SELECT TO authenticated
  USING (public.ai_picks_viewer_can_read(auth.uid()));

DROP POLICY IF EXISTS "Admin can read AI watchlist" ON public.ai_pick_watchlist;
CREATE POLICY "Admin can read AI watchlist"
  ON public.ai_pick_watchlist FOR SELECT TO authenticated
  USING (public.chat_user_is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin can read AI learning state" ON public.ai_learning_state;
CREATE POLICY "Admin can read AI learning state"
  ON public.ai_learning_state FOR SELECT TO authenticated
  USING (public.chat_user_is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin can read AI pick runs" ON public.ai_pick_runs;
CREATE POLICY "Admin can read AI pick runs"
  ON public.ai_pick_runs FOR SELECT TO authenticated
  USING (public.chat_user_is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime: new picks and results appear without a refresh
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_picks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_picks;
  END IF;
END $$;

UPDATE public.chat_rooms
SET description = 'Stattrackr AI picks: posted, tracked and graded automatically.'
WHERE slug = 'picks';
