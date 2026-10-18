-- Community chat is open to every signed-in user. The legacy "picks" room stays premium;
-- AI picks themselves are gated separately by ai_picks_viewer_can_read().
UPDATE public.chat_rooms
SET is_premium = false
WHERE slug <> 'picks';
