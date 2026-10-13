-- ONE-OFF: fresh start for the AI Picks room. Cannot be undone.
-- Deletes every message in the Picks chat room (reactions go with them via ON DELETE CASCADE)
-- and every row in the old manual record (official_picks_bets).

BEGIN;

DELETE FROM public.chat_messages
WHERE room_id IN (SELECT id FROM public.chat_rooms WHERE slug = 'picks');

DELETE FROM public.official_picks_bets;

COMMIT;
