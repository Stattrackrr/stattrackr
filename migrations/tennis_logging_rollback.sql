-- Rollback for tennis_logging.sql. Drops every tennis logging table and its data.
BEGIN;
DROP TABLE IF EXISTS public.tennis_rules;
DROP TABLE IF EXISTS public.book_void_rules;
DROP TABLE IF EXISTS public.tennis_raw_payloads;
DROP TABLE IF EXISTS public.tennis_shadow_bets;
DROP TABLE IF EXISTS public.tennis_candidates;
DROP TABLE IF EXISTS public.tennis_arm_snapshots;
DROP TABLE IF EXISTS public.tennis_poll_heartbeats CASCADE;
DROP TABLE IF EXISTS public.tennis_quotes CASCADE;
DROP TABLE IF EXISTS public.tennis_matches;
COMMIT;
