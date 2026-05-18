-- Fix first pick date: was wrongly stored as Feb 4; should be 2 April 2026 (02/04/26 DD/MM/YY).
UPDATE public.official_picks_bets
SET date = '2026-04-02'
WHERE date = '2026-02-04'
  AND selection = '6 leg multi'
  AND odds = 2.000
  AND stake_units = 2;
