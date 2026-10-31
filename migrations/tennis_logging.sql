-- Tennis model logging (spec section 18, lean build: collect everything, defer analysis).
-- Idempotent and transactional. Rollback: migrations/tennis_logging_rollback.sql.
-- Writes never depend on foreign keys: references are plain columns, checked by the integrity job.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tennis_matches (
  match_id TEXT PRIMARY KEY,
  oddsnet_event_id TEXT,
  tour TEXT,
  tier TEXT,
  tournament TEXT,
  surface TEXT,
  best_of INTEGER NOT NULL,
  is_grand_slam BOOLEAN NOT NULL DEFAULT FALSE,
  rules_version TEXT NOT NULL,
  home_id TEXT,
  home_name TEXT NOT NULL,
  away_id TEXT,
  away_name TEXT NOT NULL,
  scheduled_start TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  live_seen_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'completed', 'retired', 'walkover', 'default', 'cancelled', 'unknown')),
  retired_side TEXT,
  score TEXT,
  set_scores JSONB,
  completed BOOLEAN,
  graded_at TIMESTAMPTZ,
  policy_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tennis_matches_start_idx ON public.tennis_matches (scheduled_start);
CREATE INDEX IF NOT EXISTS tennis_matches_ungraded_idx ON public.tennis_matches (graded_at) WHERE graded_at IS NULL;

-- Prices on change. Partitioned by month; the default partition catches anything outside the range so an
-- insert never fails for want of a partition.
CREATE TABLE IF NOT EXISTS public.tennis_quotes (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  match_id TEXT NOT NULL,
  feed TEXT NOT NULL,
  book TEXT NOT NULL,
  market TEXT NOT NULL,
  line NUMERIC,
  selection TEXT NOT NULL,
  price NUMERIC NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  source_ts TIMESTAMPTZ,
  ts_source TEXT NOT NULL CHECK (ts_source IN ('book', 'capture')),
  mapping_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  PRIMARY KEY (id, first_seen_at)
) PARTITION BY RANGE (first_seen_at);

-- One row per match, feed and poll: success or failure, and each returned book's own time (null if none).
CREATE TABLE IF NOT EXISTS public.tennis_poll_heartbeats (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  match_id TEXT NOT NULL,
  feed TEXT NOT NULL,
  polled_at TIMESTAMPTZ NOT NULL,
  ok BOOLEAN NOT NULL,
  error TEXT,
  books JSONB NOT NULL DEFAULT '{}'::jsonb,
  n_quotes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, polled_at)
) PARTITION BY RANGE (polled_at);

DO $$
DECLARE
  m DATE := DATE '2026-11-01';
  t TEXT;
BEGIN
  WHILE m < DATE '2028-01-01' LOOP
    FOREACH t IN ARRAY ARRAY['tennis_quotes', 'tennis_poll_heartbeats'] LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
        t || '_' || to_char(m, 'YYYYMM'), t, m, (m + INTERVAL '1 month')::date
      );
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t || '_' || to_char(m, 'YYYYMM'));
    END LOOP;
    m := (m + INTERVAL '1 month')::date;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['tennis_quotes', 'tennis_poll_heartbeats'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I DEFAULT', t || '_default', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t || '_default');
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS tennis_quotes_lookup_idx ON public.tennis_quotes (match_id, book, market, line, selection, first_seen_at);
CREATE INDEX IF NOT EXISTS tennis_heartbeats_lookup_idx ON public.tennis_poll_heartbeats (match_id, feed, polled_at);

-- One per match and arm: the sharp fairs and the arm's model (theta, covariance, coherence, tau, rho, order).
CREATE TABLE IF NOT EXISTS public.tennis_arm_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  arm TEXT NOT NULL CHECK (arm IN ('main', 'late', 'close')),
  captured_at TIMESTAMPTZ NOT NULL,
  minutes_to_start NUMERIC,
  sharp JSONB NOT NULL DEFAULT '[]'::jsonb,
  model JSONB,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  calibration_version TEXT NOT NULL,
  n_candidates INTEGER NOT NULL DEFAULT 0,
  n_one_sided INTEGER NOT NULL DEFAULT 0,
  policy_version TEXT NOT NULL,
  UNIQUE (match_id, arm)
);
CREATE INDEX IF NOT EXISTS tennis_arm_snapshots_time_idx ON public.tennis_arm_snapshots (match_id, captured_at);

-- Every Australian book's two-way market, both sides, at every arm (the full universe).
CREATE TABLE IF NOT EXISTS public.tennis_candidates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arm_snapshot_id UUID NOT NULL,
  match_id TEXT NOT NULL,
  arm TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  book TEXT NOT NULL,
  market TEXT NOT NULL,
  line NUMERIC,
  selection TEXT NOT NULL,
  price NUMERIC NOT NULL,
  q NUMERIC,
  overround NUMERIC,
  fair NUMERIC NOT NULL,
  fair_source TEXT NOT NULL CHECK (fair_source IN ('sharp_direct', 'sharp_converted', 'model')),
  line_distance NUMERIC,
  half_lines INTEGER,
  sharp_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  same_line_tol NUMERIC NOT NULL,
  calibration_state TEXT NOT NULL CHECK (calibration_state IN ('prior', 'fitted')),
  edge NUMERIC,
  ev NUMERIC NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  price_5m NUMERIC,
  price_10m NUMERIC,
  price_20m NUMERIC,
  policy_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tennis_candidates_match_idx ON public.tennis_candidates (match_id, arm);
CREATE INDEX IF NOT EXISTS tennis_candidates_source_idx ON public.tennis_candidates (fair_source, market);
CREATE INDEX IF NOT EXISTS tennis_candidates_checks_idx ON public.tennis_candidates (captured_at) WHERE price_20m IS NULL AND ev >= 0;

-- One would-be bet per match at the main arm (frozen v0 rules). is_beta marks the ones shown to members.
CREATE TABLE IF NOT EXISTS public.tennis_shadow_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  arm_snapshot_id UUID NOT NULL,
  candidate_id BIGINT,
  book TEXT NOT NULL,
  market TEXT NOT NULL,
  line NUMERIC,
  selection TEXT NOT NULL,
  price NUMERIC NOT NULL,
  fair NUMERIC NOT NULL,
  fair_source TEXT NOT NULL,
  edge NUMERIC,
  ev NUMERIC NOT NULL,
  is_beta BOOLEAN NOT NULL DEFAULT FALSE,
  price_5m NUMERIC,
  price_10m NUMERIC,
  price_20m NUMERIC,
  vanished BOOLEAN,
  close_fair NUMERIC,
  clv JSONB,
  result TEXT CHECK (result IN ('win', 'loss', 'push', 'void')),
  grader_version TEXT,
  rule_unverified BOOLEAN,
  graded_at TIMESTAMPTZ,
  policy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, policy_version)
);

-- Raw payloads live gzipped in object storage (bucket tennis-raw); this is the index.
CREATE TABLE IF NOT EXISTS public.tennis_raw_payloads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed TEXT NOT NULL,
  polled_at TIMESTAMPTZ NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  n_matches INTEGER NOT NULL,
  raw_expired BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS tennis_raw_payloads_time_idx ON public.tennis_raw_payloads (polled_at);

-- Each book's settlement rules, verified per market from its own terms.
CREATE TABLE IF NOT EXISTS public.book_void_rules (
  book TEXT NOT NULL,
  market TEXT NOT NULL,
  rule TEXT NOT NULL,
  unfinished_game_counts BOOLEAN,
  super_tiebreak_one_game BOOLEAN,
  source_url TEXT,
  checked_at DATE,
  notes TEXT,
  PRIMARY KEY (book, market)
);

-- Tournament-year rules with their source.
CREATE TABLE IF NOT EXISTS public.tennis_rules (
  rules_version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  best_of INTEGER NOT NULL,
  final_set TEXT NOT NULL,
  source TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO public.tennis_rules (rules_version, description, best_of, final_set, source, verified) VALUES
  ('default-2026-unverified:3', 'Best of 3, tiebreak at 6-6 in every set', 3, 'tb 6 to 7', 'ATP/WTA rulebooks (to verify per event)', FALSE),
  ('default-2026-unverified:3-slam', 'Women''s slam: best of 3, final set 10-point tiebreak at 6-6', 3, 'tb 6 to 10', 'Grand Slam rules since 2022 (to verify)', FALSE),
  ('default-2026-unverified:5-slam', 'Men''s slam: best of 5, final set 10-point tiebreak at 6-6', 5, 'tb 6 to 10', 'Grand Slam rules since 2022 (to verify)', FALSE)
ON CONFLICT (rules_version) DO NOTHING;

ALTER TABLE public.tennis_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_poll_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_arm_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_shadow_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_raw_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_void_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_rules ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Make the API see the new tables straight away.
NOTIFY pgrst, 'reload schema';
