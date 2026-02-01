-- ============================================
-- INSERT PROPS FOR admin@stattrackr
-- Stake: $50 on all plays. Run in Supabase SQL Editor.
-- ============================================

DO $$
DECLARE
  target_user_id UUID;
  base_stake DECIMAL(10,2) := 50.00;
BEGIN
  SELECT id INTO target_user_id FROM auth.users WHERE email = 'admin@stattrackr' LIMIT 1;
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email admin@stattrackr.';
  END IF;

  INSERT INTO bets (
    user_id, date, sport, market, selection, stake, currency, odds, result, status,
    player_name, stat_type, line, over_under, game_date, bookmaker, created_at
  ) VALUES
    -- 27/01/2026
    (target_user_id, '2026-01-27', 'NBA', 'Player Props', 'Jeremiah Fears over 1.5 rebounds vs OKC', base_stake, 'USD', 1.55, 'win', 'completed', 'Jeremiah Fears', 'reb', 1.5, 'over', '2026-01-27', 'FanDuel', NOW()),
    (target_user_id, '2026-01-27', 'NBA', 'Player Props', 'Dillon Brooks over 3.5 rebounds vs BKN', base_stake, 'USD', 1.66, 'loss', 'completed', 'Dillon Brooks', 'reb', 3.5, 'over', '2026-01-27', 'FanDuel', NOW()),
    (target_user_id, '2026-01-27', 'NBA', 'Player Props', 'Brook Lopez over 4.5 Points vs UTAH', base_stake, 'USD', 1.73, 'win', 'completed', 'Brook Lopez', 'pts', 4.5, 'over', '2026-01-27', 'FanDuel', NOW()),
    -- 28/01/2026
    (target_user_id, '2026-01-28', 'NBA', 'Player Props', 'Onyeka Okongwu over 1.5 3pm vs BOS', base_stake, 'USD', 1.65, 'win', 'completed', 'Onyeka Okongwu', 'fg3m', 1.5, 'over', '2026-01-28', 'FanDuel', NOW()),
    (target_user_id, '2026-01-28', 'NBA', 'Player Props', 'RJ Barrett over 12.5 points vs NYK', base_stake, 'USD', 1.70, 'win', 'completed', 'RJ Barrett', 'pts', 12.5, 'over', '2026-01-28', 'FanDuel', NOW());

  RAISE NOTICE 'Inserted 5 props for admin@stattrackr. Stake: $50 each.';
END $$;
