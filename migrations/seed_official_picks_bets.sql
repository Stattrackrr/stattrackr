-- Seed official StatTrackr picks record (free + premium plays).
-- Run AFTER migrations/create_official_picks_bets.sql
--
-- Dates: DD/MM/YY (Australian). 02/04/26 = 2 April 2026 (day 2, month 04).
-- "Won/Lost 2 units" = result win/loss + stake_units 2 (not +/- P&L).
-- 30/04/29 corrected to 30/04/26.
-- 17/05 loss (5 leg) had no odds listed — defaulted to 1.85; edit in Supabase if different.
--
-- Re-running? Uncomment the line below first (wipes all official picks):
-- TRUNCATE public.official_picks_bets;

INSERT INTO public.official_picks_bets (date, sport, market, selection, stake_units, odds, result)
VALUES
  ('2026-04-02', 'Multi', 'Parlay', '6 leg multi', 2, 2.000, 'win'),
  ('2026-04-09', 'Multi', 'Single', 'Single bet', 2, 1.830, 'win'),
  ('2026-04-10', 'Multi', 'Parlay', '2 leg multi', 2, 1.850, 'win'),
  ('2026-04-11', 'Multi', 'Parlay', '2 leg multi', 2, 1.850, 'win'),
  ('2026-04-16', 'Multi', 'Parlay', '2 leg multi', 2, 1.800, 'win'),
  ('2026-04-17', 'Multi', 'Parlay', '4 leg multi', 2, 2.000, 'loss'),
  ('2026-04-18', 'Multi', 'Parlay', '3 leg multi', 2, 1.850, 'win'),
  ('2026-04-23', 'Multi', 'Parlay', '3 leg multi', 2, 1.800, 'win'),
  ('2026-04-26', 'Multi', 'Parlay', '3 leg multi', 2, 1.850, 'win'),
  ('2026-04-30', 'Multi', 'Parlay', '4 leg multi', 2, 1.850, 'loss'),
  ('2026-05-01', 'Multi', 'Parlay', '3 leg multi', 2, 2.000, 'win'),
  ('2026-05-03', 'Multi', 'Parlay', '3 leg multi', 2, 2.000, 'win'),
  ('2026-05-06', 'Multi', 'Single', 'Single bet', 2, 1.790, 'win'),
  ('2026-05-08', 'Multi', 'Parlay', '3 leg multi', 2, 1.800, 'loss'),
  ('2026-05-10', 'Multi', 'Parlay', '4 leg multi', 2, 1.850, 'win'),
  ('2026-05-10', 'Multi', 'Parlay', '4 leg multi', 2, 1.800, 'win'),
  ('2026-05-14', 'Multi', 'Parlay', '3 leg multi', 2, 1.850, 'loss'),
  ('2026-05-15', 'Multi', 'Parlay', '3 leg multi', 2, 1.900, 'loss'),
  ('2026-05-16', 'Multi', 'Parlay', '5 leg multi', 2, 1.850, 'win'),
  ('2026-05-17', 'Multi', 'Parlay', '5 leg multi', 2, 1.800, 'win'),
  ('2026-05-17', 'Multi', 'Parlay', '5 leg multi', 2, 1.850, 'win'),
  ('2026-05-17', 'Multi', 'Parlay', '5 leg multi', 2, 1.850, 'loss');
