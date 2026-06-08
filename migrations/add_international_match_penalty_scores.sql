-- Penalty-shootout scores for knockout matches that finished level after ET.
-- Populated from API-Football `score.penalty` on ingest / backfill.
ALTER TABLE international_matches
  ADD COLUMN IF NOT EXISTS home_score_penalty integer,
  ADD COLUMN IF NOT EXISTS away_score_penalty integer,
  ADD COLUMN IF NOT EXISTS has_penalty_shootout boolean;
