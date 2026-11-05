BEGIN;
DELETE FROM public.book_void_rules WHERE checked_at = DATE '2026-11-01';
ALTER TABLE public.tennis_shadow_bets DROP COLUMN IF EXISTS result_house;
ALTER TABLE public.tennis_matches DROP COLUMN IF EXISTS winner_side;
COMMIT;
NOTIFY pgrst, 'reload schema';
