BEGIN;
ALTER TABLE public.tennis_matches
  DROP COLUMN IF EXISTS indoor,
  DROP COLUMN IF EXISTS court_speed,
  DROP COLUMN IF EXISTS court_pace,
  DROP COLUMN IF EXISTS venue_city,
  DROP COLUMN IF EXISTS venue_country,
  DROP COLUMN IF EXISTS venue_lat,
  DROP COLUMN IF EXISTS venue_lng,
  DROP COLUMN IF EXISTS home_hand,
  DROP COLUMN IF EXISTS away_hand,
  DROP COLUMN IF EXISTS ended_seen_at,
  DROP COLUMN IF EXISTS minutes_observed;
COMMIT;
NOTIFY pgrst, 'reload schema';
