-- ONE-OFF: clears every AI pick posted so far. Cannot be undone.
-- Legs go with their picks (ON DELETE CASCADE). Watchlist rows stay as they are, so the exact
-- plays that were posted are not posted again; the learning loop keeps grading the watchlist.

BEGIN;

DELETE FROM public.ai_picks;

COMMIT;
