-- ============================================
-- GENERATE 100 MOCK BETS — JANUARY 2025 (FRESH)
-- 1) Deletes ALL existing Jan + Feb 2025 bets for the user
-- 2) Inserts 100 fresh bets in January: $50 each, 2 days with NO bets (Jan 8, 19) = grey
-- 3) Outcomes shaped so P&L graph CLIMBS: up a bit, small dip, up more, small dip, etc. (no sawtooth)
--    Uses 55 wins / 45 losses with losses spread (no long loss streaks) → steady upward drift.
-- Run in Supabase SQL Editor. Target: marcusduartereal@gmail.com
-- ============================================

DO $$
DECLARE
  target_user_id UUID;
  base_stake DECIMAL(10,2) := 50.00;
  bet_dates DATE[] := '{}';
  outcomes TEXT[] := '{}';
  -- 20-bet pattern: 11 W, 9 L (55/45 over 100). Losses never adjacent → small dips, no big drops.
  climb_pattern TEXT[] := ARRAY['win','loss','win','loss','win','loss','win','loss','win','loss','win','loss','win','loss','win','loss','win','win','win','loss'];
  d INT;
  day_idx INT := 0;
  n INT;
  j INT;
  i INT;
  bdate DATE;
  bresult TEXT;
  players TEXT[] := ARRAY['LeBron James','Stephen Curry','Kevin Durant','Luka Doncic','Jayson Tatum','Nikola Jokic','Joel Embiid','Giannis Antetokounmpo','Devin Booker','Damian Lillard','Anthony Davis','Trae Young','Ja Morant','Zion Williamson','Shai Gilgeous-Alexander','Tyrese Haliburton','Jaylen Brown','Pascal Siakam','Dejounte Murray','Fred VanVleet'];
  stat_types TEXT[] := ARRAY['pts','reb','ast','stl','blk','fg3m'];
  stat_labels TEXT[] := ARRAY['Points','Rebounds','Assists','Steals','Blocks','3-Pointers Made'];
  bookmakers TEXT[] := ARRAY['DraftKings','FanDuel','BetMGM','Caesars','PointsBet','BetRivers'];
  pi INT; si INT; ln DECIMAL; sel TEXT; mk TEXT; ov TEXT; od DECIMAL; act DECIMAL;
BEGIN
  -- Resolve user by email
  SELECT id INTO target_user_id FROM auth.users WHERE email = 'marcusduartereal@gmail.com' LIMIT 1;
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email marcusduartereal@gmail.com.';
  END IF;

  -- Remove ALL January and February 2025 bets for this user
  DELETE FROM bets
  WHERE user_id = target_user_id AND date >= '2025-01-01' AND date < '2025-03-01';

  -- Build 100 bet dates: Jan 2025, skip 8 and 19
  FOR d IN 1..31 LOOP
    IF d IN (8, 19) THEN CONTINUE; END IF;
    day_idx := day_idx + 1;
    n := CASE WHEN day_idx <= 13 THEN 4 ELSE 3 END;
    FOR j IN 1..n LOOP
      bet_dates := bet_dates || (DATE '2025-01-01' + (d - 1));
      EXIT WHEN array_length(bet_dates, 1) >= 100;
    END LOOP;
    EXIT WHEN array_length(bet_dates, 1) >= 100;
  END LOOP;

  IF array_length(bet_dates, 1) > 100 THEN
    bet_dates := bet_dates[1:100];
  END IF;

  -- Outcomes from repeating pattern: 11W + 9L per 20, losses never adjacent → climb with small dips
  FOR i IN 1..100 LOOP
    outcomes := outcomes || climb_pattern[((i - 1) % 20) + 1];
  END LOOP;

  -- Insert 100 bets: P&L will climb with small down-dips, no sawtooth
  FOR i IN 1..100 LOOP
    bdate := bet_dates[i];
    bresult := outcomes[i];
    pi := 1 + (i % array_length(players, 1));
    si := 1 + ((i * 3) % array_length(stat_types, 1));
    ln := 20 + (i % 12) + (0.5 * (i % 2));
    ov := CASE WHEN i % 3 <> 0 THEN 'over' ELSE 'under' END;
    od := 1.80 + (0.02 * (i % 8)) + (0.005 * (i % 4));
    act := CASE
      WHEN bresult = 'win' AND ov = 'over' THEN ln + 1.5 + (i % 4)
      WHEN bresult = 'win' AND ov = 'under' THEN GREATEST(0.5, ln - 2.0 - (i % 3))
      WHEN bresult = 'loss' AND ov = 'over' THEN GREATEST(0, ln - 2.0 - (i % 3))
      ELSE ln + 2.0 + (i % 3)
    END;
    sel := players[pi] || ' ' || ov || ' ' || ln || ' ' || stat_labels[si];
    mk := 'Player ' || stat_labels[si];

    INSERT INTO bets (
      user_id, date, sport, market, selection, stake, currency, odds, result, status,
      player_name, stat_type, line, over_under, actual_value, game_date, bookmaker, created_at
    ) VALUES (
      target_user_id, bdate, 'NBA', mk, sel, base_stake, 'USD', od, bresult, 'completed',
      players[pi], stat_types[si], ln, ov, act, bdate, bookmakers[1 + (i % array_length(bookmakers, 1))], NOW()
    );
  END LOOP;

  RAISE NOTICE 'Deleted existing Jan+Feb 2025 bets; inserted 100 fresh January bets for user %', target_user_id;
  RAISE NOTICE '  $50 each. No bets Jan 8 & 19 (grey). 55W/45L, losses spread so P&L climbs with small dips.';
END $$;
