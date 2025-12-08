-- ============================================
-- JOURNAL BETS VIEWING SCRIPT
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. VIEW ALL JOURNAL BETS WITH USER INFO
-- Shows all bets with user email and comprehensive details
SELECT 
  b.id,
  u.email as user_email,
  b.user_id,
  b.date as bet_date,
  b.sport,
  b.market,
  b.selection,
  b.stake,
  b.currency,
  b.odds,
  b.result,
  b.status,
  b.bookmaker,
  
  -- NBA Prop specific fields
  b.player_id,
  b.player_name,
  b.team,
  b.opponent,
  b.stat_type,
  b.line,
  b.over_under,
  b.actual_value,
  b.game_date,
  
  -- Parlay data
  b.parlay_legs,
  
  -- Timestamps
  b.created_at,
  b.updated_at,
  
  -- Calculate potential payout
  ROUND((b.stake * b.odds)::numeric, 2) as potential_payout,
  
  -- Calculate profit/loss
  CASE 
    WHEN b.result = 'win' THEN ROUND(((b.stake * b.odds) - b.stake)::numeric, 2)
    WHEN b.result = 'loss' THEN ROUND(-b.stake::numeric, 2)
    WHEN b.result = 'void' THEN 0
    ELSE NULL
  END as profit_loss

FROM bets b
LEFT JOIN auth.users u ON b.user_id = u.id
ORDER BY b.created_at DESC;

-- ============================================
-- 2. VIEW BETS BY SPECIFIC USER (replace 'user@example.com' with actual email)
-- ============================================
SELECT 
  b.id,
  b.date as bet_date,
  b.sport,
  b.market,
  b.selection,
  b.stake,
  b.currency,
  b.odds,
  b.result,
  b.status,
  b.bookmaker,
  b.player_name,
  b.team,
  b.opponent,
  b.stat_type,
  b.line,
  b.over_under,
  b.actual_value,
  b.game_date,
  b.parlay_legs,
  b.created_at,
  CASE 
    WHEN b.result = 'win' THEN ROUND(((b.stake * b.odds) - b.stake)::numeric, 2)
    WHEN b.result = 'loss' THEN ROUND(-b.stake::numeric, 2)
    ELSE NULL
  END as profit_loss
FROM bets b
INNER JOIN auth.users u ON b.user_id = u.id
WHERE u.email = 'user@example.com'  -- Replace with actual email
ORDER BY b.date DESC, b.created_at DESC;

-- ============================================
-- 3. SUMMARY STATISTICS BY USER
-- ============================================
SELECT 
  u.email as user_email,
  COUNT(*) as total_bets,
  COUNT(*) FILTER (WHERE b.result = 'win') as wins,
  COUNT(*) FILTER (WHERE b.result = 'loss') as losses,
  COUNT(*) FILTER (WHERE b.result = 'void') as voids,
  COUNT(*) FILTER (WHERE b.result = 'pending') as pending,
  ROUND(SUM(b.stake)::numeric, 2) as total_staked,
  ROUND(SUM(CASE WHEN b.result = 'win' THEN (b.stake * b.odds) ELSE 0 END)::numeric, 2) as total_won,
  ROUND(SUM(CASE WHEN b.result = 'loss' THEN b.stake ELSE 0 END)::numeric, 2) as total_lost,
  ROUND(
    SUM(CASE 
      WHEN b.result = 'win' THEN (b.stake * b.odds) - b.stake
      WHEN b.result = 'loss' THEN -b.stake
      ELSE 0
    END)::numeric, 
    2
  ) as net_profit_loss,
  ROUND(
    (COUNT(*) FILTER (WHERE b.result = 'win')::numeric / 
     NULLIF(COUNT(*) FILTER (WHERE b.result IN ('win', 'loss')), 0)) * 100, 
    2
  ) as win_percentage
FROM bets b
INNER JOIN auth.users u ON b.user_id = u.id
GROUP BY u.email, u.id
ORDER BY total_bets DESC;

-- ============================================
-- 4. NBA PROP BETS ONLY (with player details)
-- ============================================
SELECT 
  b.id,
  u.email as user_email,
  b.player_name,
  b.team,
  b.opponent,
  b.stat_type,
  b.line,
  b.over_under,
  b.actual_value,
  b.game_date,
  b.result,
  b.status,
  b.stake,
  b.currency,
  b.odds,
  b.bookmaker,
  b.created_at,
  CASE 
    WHEN b.actual_value IS NOT NULL AND b.line IS NOT NULL THEN
      CASE 
        WHEN b.over_under = 'over' AND b.actual_value > b.line THEN 'WIN'
        WHEN b.over_under = 'under' AND b.actual_value < b.line THEN 'WIN'
        WHEN b.actual_value = b.line THEN 'PUSH'
        ELSE 'LOSS'
      END
    ELSE NULL
  END as calculated_result
FROM bets b
LEFT JOIN auth.users u ON b.user_id = u.id
WHERE b.sport = 'NBA' 
  AND b.player_name IS NOT NULL
ORDER BY b.game_date DESC, b.created_at DESC;

-- ============================================
-- 5. PARLAY BETS ONLY
-- ============================================
SELECT 
  b.id,
  u.email as user_email,
  b.date as bet_date,
  b.market,
  b.selection,
  b.stake,
  b.currency,
  b.odds,
  b.result,
  b.status,
  b.bookmaker,
  b.parlay_legs,
  jsonb_array_length(COALESCE(b.parlay_legs, '[]'::jsonb)) as num_legs,
  b.created_at,
  CASE 
    WHEN b.result = 'win' THEN ROUND(((b.stake * b.odds) - b.stake)::numeric, 2)
    WHEN b.result = 'loss' THEN ROUND(-b.stake::numeric, 2)
    ELSE NULL
  END as profit_loss
FROM bets b
LEFT JOIN auth.users u ON b.user_id = u.id
WHERE b.market LIKE 'Parlay%' OR b.parlay_legs IS NOT NULL
ORDER BY b.created_at DESC;

-- ============================================
-- 6. PENDING BETS (not yet resolved)
-- ============================================
SELECT 
  b.id,
  u.email as user_email,
  b.date as bet_date,
  b.sport,
  b.market,
  b.selection,
  b.player_name,
  b.game_date,
  b.status,
  b.result,
  b.stake,
  b.odds,
  b.created_at,
  CASE 
    WHEN b.game_date IS NOT NULL THEN 
      CASE 
        WHEN b.game_date < CURRENT_DATE THEN 'Past due'
        WHEN b.game_date = CURRENT_DATE THEN 'Today'
        ELSE 'Future'
      END
    ELSE NULL
  END as game_status
FROM bets b
LEFT JOIN auth.users u ON b.user_id = u.id
WHERE b.result = 'pending' OR b.status IN ('pending', 'live')
ORDER BY 
  CASE 
    WHEN b.game_date IS NOT NULL THEN b.game_date
    ELSE b.date
  END ASC,
  b.created_at DESC;

-- ============================================
-- 7. BETS BY DATE RANGE (last 30 days)
-- ============================================
SELECT 
  b.id,
  u.email as user_email,
  b.date as bet_date,
  b.sport,
  b.market,
  b.selection,
  b.result,
  b.stake,
  b.odds,
  b.bookmaker,
  CASE 
    WHEN b.result = 'win' THEN ROUND(((b.stake * b.odds) - b.stake)::numeric, 2)
    WHEN b.result = 'loss' THEN ROUND(-b.stake::numeric, 2)
    ELSE NULL
  END as profit_loss
FROM bets b
LEFT JOIN auth.users u ON b.user_id = u.id
WHERE b.date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY b.date DESC, b.created_at DESC;

-- ============================================
-- 8. BETS BY SPORT
-- ============================================
SELECT 
  b.sport,
  COUNT(*) as total_bets,
  COUNT(*) FILTER (WHERE b.result = 'win') as wins,
  COUNT(*) FILTER (WHERE b.result = 'loss') as losses,
  COUNT(*) FILTER (WHERE b.result = 'pending') as pending,
  ROUND(SUM(b.stake)::numeric, 2) as total_staked,
  ROUND(
    SUM(CASE 
      WHEN b.result = 'win' THEN (b.stake * b.odds) - b.stake
      WHEN b.result = 'loss' THEN -b.stake
      ELSE 0
    END)::numeric, 
    2
  ) as net_profit_loss
FROM bets b
GROUP BY b.sport
ORDER BY total_bets DESC;

-- ============================================
-- 9. RECENT BETS (last 10 bets across all users)
-- ============================================
SELECT 
  b.id,
  u.email as user_email,
  b.date as bet_date,
  b.sport,
  b.market,
  b.selection,
  b.result,
  b.stake,
  b.currency,
  b.odds,
  b.bookmaker,
  b.created_at
FROM bets b
LEFT JOIN auth.users u ON b.user_id = u.id
ORDER BY b.created_at DESC
LIMIT 10;

-- ============================================
-- 10. VIEW PARLAY LEGS EXPANDED (for detailed parlay analysis)
-- ============================================
SELECT 
  b.id as bet_id,
  u.email as user_email,
  b.date as bet_date,
  b.result as bet_result,
  b.stake,
  b.odds,
  leg.*
FROM bets b
LEFT JOIN auth.users u ON b.user_id = u.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.parlay_legs, '[]'::jsonb)) as leg
WHERE b.parlay_legs IS NOT NULL
ORDER BY b.created_at DESC, leg->>'playerName';









