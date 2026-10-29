-- Full-universe NBA prop logging (agreed build spec, Part B). Every main-line player prop on the pre-tip
-- board is snapshotted (first seen, 6h, 2h, close, injury changes, US moves) with its prices, fair
-- probabilities, point-in-time context and features, then graded. Rows are never deleted: did-not-play,
-- early exits and unmatched names stay, so the sample cannot drift toward players who finished games.
-- Server-only: RLS on with no policies (the service role bypasses it).

CREATE TABLE IF NOT EXISTS public.nba_prop_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  tip_at TIMESTAMPTZ NOT NULL,
  player_id TEXT,
  player_name TEXT NOT NULL,
  board_name TEXT NOT NULL,
  unmatched BOOLEAN NOT NULL DEFAULT FALSE,
  team TEXT,
  opponent TEXT,
  stat TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL CHECK (snapshot_kind IN ('first', 't6h', 't2h', 'close', 'injury_change', 'us_move')),
  captured_at TIMESTAMPTZ NOT NULL,
  main_line NUMERIC NOT NULL,
  n_books INTEGER NOT NULL,
  book_dispersion NUMERIC,
  -- Power de-vig, median per group; *_mult is multiplicative de-vig over all books.
  fair_over_all NUMERIC,
  fair_over_all_mult NUMERIC,
  fair_over_us NUMERIC,
  fair_over_pinnacle NUMERIC,
  fair_over_au NUMERIC,
  best_au_over NUMERIC,
  best_au_over_book TEXT,
  best_au_over_confirmed BOOLEAN,
  best_au_under NUMERIC,
  best_au_under_book TEXT,
  best_au_under_confirmed BOOLEAN,
  market_spread NUMERIC,
  market_total NUMERIC,
  implied_team_total NUMERIC,
  injury_report JSONB,
  injury_source_ts TIMESTAMPTZ,
  lineup_version_id UUID,
  starter_basis TEXT,
  role_changed_recently BOOLEAN,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  played BOOLEAN,
  result_value NUMERIC,
  result_minutes NUMERIC,
  early_exit BOOLEAN,
  -- Each side graded by the AI picks' NBA rules: did not play = void; a first-half injury exit voids
  -- only a bet it would otherwise lose; an ejection stands.
  result_over TEXT CHECK (result_over IN ('win', 'loss', 'push', 'void')),
  result_under TEXT CHECK (result_under IN ('win', 'loss', 'push', 'void')),
  result_note TEXT,
  graded_at TIMESTAMPTZ,
  model_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nba_prop_snapshots_uniq
  ON public.nba_prop_snapshots (game_id, board_name, stat, snapshot_kind, captured_at);
CREATE INDEX IF NOT EXISTS nba_prop_snapshots_tip_idx ON public.nba_prop_snapshots (tip_at);
CREATE INDEX IF NOT EXISTS nba_prop_snapshots_player_idx ON public.nba_prop_snapshots (player_id, stat);
CREATE INDEX IF NOT EXISTS nba_prop_snapshots_ungraded_idx ON public.nba_prop_snapshots (tip_at) WHERE graded_at IS NULL;

-- One row per book per snapshot. Source timestamps are the book's own; captured_at is ours.
CREATE TABLE IF NOT EXISTS public.nba_prop_book_quotes (
  snapshot_id UUID NOT NULL REFERENCES public.nba_prop_snapshots(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  line NUMERIC NOT NULL,
  over_price NUMERIC,
  under_price NUMERIC,
  source_ts TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL,
  seen_prev_poll BOOLEAN,
  coherent BOOLEAN,
  PRIMARY KEY (snapshot_id, book)
);

-- Would-be bets under a frozen policy ('main': once at the first scan from 2h before tip; 'news':
-- once after each later status change). Training and evaluation use these trigger rows only.
CREATE TABLE IF NOT EXISTS public.nba_shadow_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy TEXT NOT NULL CHECK (policy IN ('main', 'news')),
  policy_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  trigger_snapshot_id UUID NOT NULL REFERENCES public.nba_prop_snapshots(id),
  game_id TEXT NOT NULL,
  player_id TEXT,
  stat TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('over', 'under')),
  line NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  book TEXT NOT NULL,
  price_confirmed BOOLEAN NOT NULL,
  model_prob NUMERIC NOT NULL,
  fair_at_decision NUMERIC NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Filled after close: total, (a) price vs decision fair, (b) fair drift, at k x 0.8 / 1 / 1.25.
  clv JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy, policy_version, trigger_snapshot_id, side)
);
CREATE INDEX IF NOT EXISTS nba_shadow_bets_game_idx ON public.nba_shadow_bets (game_id);

-- Price still available after posting (reported, never gating). Covers shadow bets and posted picks.
CREATE TABLE IF NOT EXISTS public.nba_bet_price_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_bet_id UUID REFERENCES public.nba_shadow_bets(id) ON DELETE CASCADE,
  pick_leg_id UUID,
  posted_at TIMESTAMPTZ NOT NULL,
  book TEXT NOT NULL,
  price_posted NUMERIC NOT NULL,
  price_5m NUMERIC,
  price_10m NUMERIC,
  price_20m NUMERIC,
  vanished BOOLEAN,
  CHECK (shadow_bet_id IS NOT NULL OR pick_leg_id IS NOT NULL)
);

-- Every injury-status change as first seen, never overwritten.
CREATE TABLE IF NOT EXISTS public.nba_status_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id TEXT NOT NULL,
  team TEXT,
  game_id TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  designation TEXT,
  injury_type TEXT,
  return_date TEXT,
  source_ts TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL,
  UNIQUE (player_id, to_status, captured_at)
);
CREATE INDEX IF NOT EXISTS nba_status_changes_game_idx ON public.nba_status_changes (game_id, captured_at);

-- RotoWire lineup versions: a new row whenever a team's lineup changes, never overwritten.
CREATE TABLE IF NOT EXISTS public.nba_lineup_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_key TEXT NOT NULL,
  team TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  confirmed BOOLEAN NOT NULL,
  starters JSONB NOT NULL,
  may_not_play JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'rotowire',
  content_hash TEXT NOT NULL,
  UNIQUE (game_key, team, content_hash)
);
CREATE INDEX IF NOT EXISTS nba_lineup_versions_lookup_idx ON public.nba_lineup_versions (game_key, team, fetched_at);

-- How long each Australian book takes to follow a US move, measured within one feed.
CREATE TABLE IF NOT EXISTS public.nba_au_lag (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  player_id TEXT,
  stat TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  us_move_at TIMESTAMPTZ NOT NULL,
  us_line_from NUMERIC,
  us_line_to NUMERIC,
  us_fair_from NUMERIC,
  us_fair_to NUMERIC,
  us_books_moved JSONB NOT NULL,
  book TEXT NOT NULL,
  au_line_before NUMERIC,
  au_over_before NUMERIC,
  au_under_before NUMERIC,
  au_source_ts_before TIMESTAMPTZ,
  au_followed_at TIMESTAMPTZ,
  au_line_after NUMERIC,
  au_over_after NUMERIC,
  au_under_after NUMERIC,
  lag_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nba_au_lag_game_idx ON public.nba_au_lag (game_id, us_move_at);

-- One row per poll, to see merged windows, the daily cap binding and clock drift.
CREATE TABLE IF NOT EXISTS public.nba_poll_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  polled_at TIMESTAMPTZ NOT NULL,
  triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  cap_reached BOOLEAN NOT NULL DEFAULT FALSE,
  clock_drift_ms INTEGER
);
CREATE INDEX IF NOT EXISTS nba_poll_log_day_idx ON public.nba_poll_log (polled_at);

CREATE TABLE IF NOT EXISTS public.book_accounts (
  book TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  limit_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.nba_prop_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_prop_book_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_shadow_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_bet_price_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_status_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_lineup_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_au_lag ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_poll_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_accounts ENABLE ROW LEVEL SECURITY;
