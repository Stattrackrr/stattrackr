-- Tennis logging v2: venue conditions, handedness and observed match length on tennis_matches.
-- Idempotent. Rollback: migrations/tennis_logging_v2_rollback.sql.
BEGIN;
ALTER TABLE public.tennis_matches
  ADD COLUMN IF NOT EXISTS indoor BOOLEAN,
  ADD COLUMN IF NOT EXISTS court_speed TEXT,
  ADD COLUMN IF NOT EXISTS court_pace NUMERIC,
  ADD COLUMN IF NOT EXISTS venue_city TEXT,
  ADD COLUMN IF NOT EXISTS venue_country TEXT,
  ADD COLUMN IF NOT EXISTS venue_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS venue_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS home_hand TEXT,
  ADD COLUMN IF NOT EXISTS away_hand TEXT,
  ADD COLUMN IF NOT EXISTS ended_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS minutes_observed NUMERIC;
COMMIT;
NOTIFY pgrst, 'reload schema';
