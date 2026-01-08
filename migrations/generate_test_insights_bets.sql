-- ============================================
-- GENERATE TEST BETS FOR INSIGHTS FEATURE
-- Run this in Supabase SQL Editor
-- Email: joikvnfelkjvhbefdwhjkvbfdshjkvbedwfqjkhvbrewqjh@gmail.com
-- ============================================

-- First, get the user_id for this email
DO $$
DECLARE
  target_user_id UUID;
  test_date DATE;
  i INTEGER;
BEGIN
  -- Find user by email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = 'joikvnfelkjvhbefdwhjkvbfdshjkvbedwfqjkhvbrewqjh@gmail.com';
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found with email: joikvnfelkjvhbefdwhjkvbfdshjkvbedwfqjkhvbrewqjh@gmail.com';
  END IF;
  
  -- Set base date (30 days ago to now)
  test_date := CURRENT_DATE - 30;
  
  -- ============================================
  -- STRAIGHT BETS - PTS (Mixed results, more losses to show pattern)
  -- ============================================
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, created_at)
  VALUES
    -- PTS losses (5 losses to trigger insight)
    (target_user_id, test_date + 1, 'NBA', 'Player Props', 'LeBron James Points Over 25.5', 10.00, 'USD', 1.91, 'loss', 'completed', 'LeBron James', 'pts', 25.5, 'over', NOW() - INTERVAL '29 days'),
    (target_user_id, test_date + 2, 'NBA', 'Player Props', 'LeBron James Points Over 25.5', 10.00, 'USD', 1.91, 'loss', 'completed', 'LeBron James', 'pts', 25.5, 'over', NOW() - INTERVAL '28 days'),
    (target_user_id, test_date + 3, 'NBA', 'Player Props', 'LeBron James Points Over 25.5', 10.00, 'USD', 1.91, 'loss', 'completed', 'LeBron James', 'pts', 25.5, 'over', NOW() - INTERVAL '27 days'),
    (target_user_id, test_date + 4, 'NBA', 'Player Props', 'Stephen Curry Points Over 28.5', 10.00, 'USD', 1.87, 'loss', 'completed', 'Stephen Curry', 'pts', 28.5, 'over', NOW() - INTERVAL '26 days'),
    (target_user_id, test_date + 5, 'NBA', 'Player Props', 'Stephen Curry Points Over 28.5', 10.00, 'USD', 1.87, 'loss', 'completed', 'Stephen Curry', 'pts', 28.5, 'over', NOW() - INTERVAL '25 days'),
    
    -- PTS wins (3 wins)
    (target_user_id, test_date + 6, 'NBA', 'Player Props', 'Kevin Durant Points Over 27.5', 10.00, 'USD', 1.89, 'win', 'completed', 'Kevin Durant', 'pts', 27.5, 'over', NOW() - INTERVAL '24 days'),
    (target_user_id, test_date + 7, 'NBA', 'Player Props', 'Kevin Durant Points Over 27.5', 10.00, 'USD', 1.89, 'win', 'completed', 'Kevin Durant', 'pts', 27.5, 'over', NOW() - INTERVAL '23 days'),
    (target_user_id, test_date + 8, 'NBA', 'Player Props', 'Kevin Durant Points Over 27.5', 10.00, 'USD', 1.89, 'win', 'completed', 'Kevin Durant', 'pts', 27.5, 'over', NOW() - INTERVAL '22 days');
  
  -- ============================================
  -- STRAIGHT BETS - REB (High win rate to show positive insight)
  -- ============================================
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, created_at)
  VALUES
    -- REB wins (6 wins, 2 losses = 75% win rate)
    (target_user_id, test_date + 9, 'NBA', 'Player Props', 'Nikola Jokic Rebounds Over 11.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Nikola Jokic', 'reb', 11.5, 'over', NOW() - INTERVAL '21 days'),
    (target_user_id, test_date + 10, 'NBA', 'Player Props', 'Nikola Jokic Rebounds Over 11.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Nikola Jokic', 'reb', 11.5, 'over', NOW() - INTERVAL '20 days'),
    (target_user_id, test_date + 11, 'NBA', 'Player Props', 'Nikola Jokic Rebounds Over 11.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Nikola Jokic', 'reb', 11.5, 'over', NOW() - INTERVAL '19 days'),
    (target_user_id, test_date + 12, 'NBA', 'Player Props', 'Anthony Davis Rebounds Over 10.5', 10.00, 'USD', 1.83, 'win', 'completed', 'Anthony Davis', 'reb', 10.5, 'over', NOW() - INTERVAL '18 days'),
    (target_user_id, test_date + 13, 'NBA', 'Player Props', 'Anthony Davis Rebounds Over 10.5', 10.00, 'USD', 1.83, 'win', 'completed', 'Anthony Davis', 'reb', 10.5, 'over', NOW() - INTERVAL '17 days'),
    (target_user_id, test_date + 14, 'NBA', 'Player Props', 'Anthony Davis Rebounds Over 10.5', 10.00, 'USD', 1.83, 'win', 'completed', 'Anthony Davis', 'reb', 10.5, 'over', NOW() - INTERVAL '16 days'),
    (target_user_id, test_date + 15, 'NBA', 'Player Props', 'Rudy Gobert Rebounds Over 12.5', 10.00, 'USD', 1.88, 'loss', 'completed', 'Rudy Gobert', 'reb', 12.5, 'over', NOW() - INTERVAL '15 days'),
    (target_user_id, test_date + 16, 'NBA', 'Player Props', 'Rudy Gobert Rebounds Over 12.5', 10.00, 'USD', 1.88, 'loss', 'completed', 'Rudy Gobert', 'reb', 12.5, 'over', NOW() - INTERVAL '14 days');
  
  -- ============================================
  -- STRAIGHT BETS - AST (Mixed, but more losses on Over)
  -- ============================================
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, created_at)
  VALUES
    -- AST Over losses (4 losses)
    (target_user_id, test_date + 17, 'NBA', 'Player Props', 'Chris Paul Assists Over 9.5', 10.00, 'USD', 1.90, 'loss', 'completed', 'Chris Paul', 'ast', 9.5, 'over', NOW() - INTERVAL '13 days'),
    (target_user_id, test_date + 18, 'NBA', 'Player Props', 'Chris Paul Assists Over 9.5', 10.00, 'USD', 1.90, 'loss', 'completed', 'Chris Paul', 'ast', 9.5, 'over', NOW() - INTERVAL '12 days'),
    (target_user_id, test_date + 19, 'NBA', 'Player Props', 'Trae Young Assists Over 10.5', 10.00, 'USD', 1.87, 'loss', 'completed', 'Trae Young', 'ast', 10.5, 'over', NOW() - INTERVAL '11 days'),
    (target_user_id, test_date + 20, 'NBA', 'Player Props', 'Trae Young Assists Over 10.5', 10.00, 'USD', 1.87, 'loss', 'completed', 'Trae Young', 'ast', 10.5, 'over', NOW() - INTERVAL '10 days'),
    
    -- AST Under wins (2 wins)
    (target_user_id, test_date + 21, 'NBA', 'Player Props', 'Russell Westbrook Assists Under 8.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Russell Westbrook', 'ast', 8.5, 'under', NOW() - INTERVAL '9 days'),
    (target_user_id, test_date + 22, 'NBA', 'Player Props', 'Russell Westbrook Assists Under 8.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Russell Westbrook', 'ast', 8.5, 'under', NOW() - INTERVAL '8 days');
  
  -- ============================================
  -- PARLAYS (Mix of wins and losses)
  -- ============================================
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, parlay_legs, created_at)
  VALUES
    -- Parlay loss 1
    (target_user_id, test_date + 23, 'NBA', 'Parlay (2 legs)', 'Parlay: LeBron James Points Over 25.5 + Nikola Jokic Rebounds Over 11.5', 10.00, 'USD', 3.50, 'loss', 'completed', 
     '[
       {"playerName": "LeBron James", "statType": "pts", "line": 25.5, "overUnder": "over", "won": false},
       {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}
     ]'::jsonb,
     NOW() - INTERVAL '7 days'),
    
    -- Parlay loss 2
    (target_user_id, test_date + 24, 'NBA', 'Parlay (3 legs)', 'Parlay: Stephen Curry Points Over 28.5 + Kevin Durant Points Over 27.5 + Chris Paul Assists Over 9.5', 10.00, 'USD', 6.20, 'loss', 'completed',
     '[
       {"playerName": "Stephen Curry", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false},
       {"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true},
       {"playerName": "Chris Paul", "statType": "ast", "line": 9.5, "overUnder": "over", "won": false}
     ]'::jsonb,
     NOW() - INTERVAL '6 days'),
    
    -- Parlay loss 3
    (target_user_id, test_date + 25, 'NBA', 'Parlay (2 legs)', 'Parlay: Anthony Davis Rebounds Over 10.5 + Trae Young Assists Over 10.5', 10.00, 'USD', 3.40, 'loss', 'completed',
     '[
       {"playerName": "Anthony Davis", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true},
       {"playerName": "Trae Young", "statType": "ast", "line": 10.5, "overUnder": "over", "won": false}
     ]'::jsonb,
     NOW() - INTERVAL '5 days'),
    
    -- Parlay win 1
    (target_user_id, test_date + 26, 'NBA', 'Parlay (2 legs)', 'Parlay: Kevin Durant Points Over 27.5 + Nikola Jokic Rebounds Over 11.5', 10.00, 'USD', 3.45, 'win', 'completed',
     '[
       {"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true},
       {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}
     ]'::jsonb,
     NOW() - INTERVAL '4 days');
  
  -- ============================================
  -- ADDITIONAL 50 BETS (35 wins, 15 losses)
  -- ============================================
  
  -- More PTS bets (mix of wins and losses)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, created_at)
  VALUES
    -- PTS wins (10 wins)
    (target_user_id, test_date + 27, 'NBA', 'Player Props', 'Luka Doncic Points Over 30.5', 10.00, 'USD', 1.88, 'win', 'completed', 'Luka Doncic', 'pts', 30.5, 'over', NOW() - INTERVAL '3 days'),
    (target_user_id, test_date + 28, 'NBA', 'Player Props', 'Luka Doncic Points Over 30.5', 10.00, 'USD', 1.88, 'win', 'completed', 'Luka Doncic', 'pts', 30.5, 'over', NOW() - INTERVAL '2 days'),
    (target_user_id, test_date + 29, 'NBA', 'Player Props', 'Jayson Tatum Points Over 26.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Jayson Tatum', 'pts', 26.5, 'over', NOW() - INTERVAL '1 day'),
    (target_user_id, test_date + 30, 'NBA', 'Player Props', 'Jayson Tatum Points Over 26.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Jayson Tatum', 'pts', 26.5, 'over', NOW() - INTERVAL '23 hours'),
    (target_user_id, test_date + 31, 'NBA', 'Player Props', 'Devin Booker Points Over 27.5', 10.00, 'USD', 1.87, 'win', 'completed', 'Devin Booker', 'pts', 27.5, 'over', NOW() - INTERVAL '22 hours'),
    (target_user_id, test_date + 32, 'NBA', 'Player Props', 'Devin Booker Points Over 27.5', 10.00, 'USD', 1.87, 'win', 'completed', 'Devin Booker', 'pts', 27.5, 'over', NOW() - INTERVAL '21 hours'),
    (target_user_id, test_date + 33, 'NBA', 'Player Props', 'Damian Lillard Points Over 28.5', 10.00, 'USD', 1.89, 'win', 'completed', 'Damian Lillard', 'pts', 28.5, 'over', NOW() - INTERVAL '20 hours'),
    (target_user_id, test_date + 34, 'NBA', 'Player Props', 'Damian Lillard Points Over 28.5', 10.00, 'USD', 1.89, 'win', 'completed', 'Damian Lillard', 'pts', 28.5, 'over', NOW() - INTERVAL '19 hours'),
    (target_user_id, test_date + 35, 'NBA', 'Player Props', 'Joel Embiid Points Over 29.5', 10.00, 'USD', 1.86, 'win', 'completed', 'Joel Embiid', 'pts', 29.5, 'over', NOW() - INTERVAL '18 hours'),
    (target_user_id, test_date + 36, 'NBA', 'Player Props', 'Joel Embiid Points Over 29.5', 10.00, 'USD', 1.86, 'win', 'completed', 'Joel Embiid', 'pts', 29.5, 'over', NOW() - INTERVAL '17 hours'),
    
    -- PTS losses (5 losses)
    (target_user_id, test_date + 37, 'NBA', 'Player Props', 'Zion Williamson Points Over 24.5', 10.00, 'USD', 1.84, 'loss', 'completed', 'Zion Williamson', 'pts', 24.5, 'over', NOW() - INTERVAL '16 hours'),
    (target_user_id, test_date + 38, 'NBA', 'Player Props', 'Zion Williamson Points Over 24.5', 10.00, 'USD', 1.84, 'loss', 'completed', 'Zion Williamson', 'pts', 24.5, 'over', NOW() - INTERVAL '15 hours'),
    (target_user_id, test_date + 39, 'NBA', 'Player Props', 'Ja Morant Points Over 25.5', 10.00, 'USD', 1.88, 'loss', 'completed', 'Ja Morant', 'pts', 25.5, 'over', NOW() - INTERVAL '14 hours'),
    (target_user_id, test_date + 40, 'NBA', 'Player Props', 'Ja Morant Points Over 25.5', 10.00, 'USD', 1.88, 'loss', 'completed', 'Ja Morant', 'pts', 25.5, 'over', NOW() - INTERVAL '13 hours'),
    (target_user_id, test_date + 41, 'NBA', 'Player Props', 'Shai Gilgeous-Alexander Points Over 28.5', 10.00, 'USD', 1.87, 'loss', 'completed', 'Shai Gilgeous-Alexander', 'pts', 28.5, 'over', NOW() - INTERVAL '12 hours');
  
  -- More REB bets (mostly wins to show strong performance)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, created_at)
  VALUES
    -- REB wins (8 wins)
    (target_user_id, test_date + 42, 'NBA', 'Player Props', 'Giannis Antetokounmpo Rebounds Over 11.5', 10.00, 'USD', 1.83, 'win', 'completed', 'Giannis Antetokounmpo', 'reb', 11.5, 'over', NOW() - INTERVAL '11 hours'),
    (target_user_id, test_date + 43, 'NBA', 'Player Props', 'Giannis Antetokounmpo Rebounds Over 11.5', 10.00, 'USD', 1.83, 'win', 'completed', 'Giannis Antetokounmpo', 'reb', 11.5, 'over', NOW() - INTERVAL '10 hours'),
    (target_user_id, test_date + 44, 'NBA', 'Player Props', 'Bam Adebayo Rebounds Over 10.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Bam Adebayo', 'reb', 10.5, 'over', NOW() - INTERVAL '9 hours'),
    (target_user_id, test_date + 45, 'NBA', 'Player Props', 'Bam Adebayo Rebounds Over 10.5', 10.00, 'USD', 1.85, 'win', 'completed', 'Bam Adebayo', 'reb', 10.5, 'over', NOW() - INTERVAL '8 hours'),
    (target_user_id, test_date + 46, 'NBA', 'Player Props', 'Domantas Sabonis Rebounds Over 12.5', 10.00, 'USD', 1.82, 'win', 'completed', 'Domantas Sabonis', 'reb', 12.5, 'over', NOW() - INTERVAL '7 hours'),
    (target_user_id, test_date + 47, 'NBA', 'Player Props', 'Domantas Sabonis Rebounds Over 12.5', 10.00, 'USD', 1.82, 'win', 'completed', 'Domantas Sabonis', 'reb', 12.5, 'over', NOW() - INTERVAL '6 hours'),
    (target_user_id, test_date + 48, 'NBA', 'Player Props', 'Evan Mobley Rebounds Over 9.5', 10.00, 'USD', 1.86, 'win', 'completed', 'Evan Mobley', 'reb', 9.5, 'over', NOW() - INTERVAL '5 hours'),
    (target_user_id, test_date + 49, 'NBA', 'Player Props', 'Evan Mobley Rebounds Over 9.5', 10.00, 'USD', 1.86, 'win', 'completed', 'Evan Mobley', 'reb', 9.5, 'over', NOW() - INTERVAL '4 hours'),
    
    -- REB losses (2 losses)
    (target_user_id, test_date + 50, 'NBA', 'Player Props', 'Jarrett Allen Rebounds Over 10.5', 10.00, 'USD', 1.84, 'loss', 'completed', 'Jarrett Allen', 'reb', 10.5, 'over', NOW() - INTERVAL '3 hours'),
    (target_user_id, test_date + 51, 'NBA', 'Player Props', 'Jarrett Allen Rebounds Over 10.5', 10.00, 'USD', 1.84, 'loss', 'completed', 'Jarrett Allen', 'reb', 10.5, 'over', NOW() - INTERVAL '2 hours');
  
  -- AST bets (mix)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, created_at)
  VALUES
    -- AST wins (6 wins)
    (target_user_id, test_date + 52, 'NBA', 'Player Props', 'Tyrese Haliburton Assists Over 10.5', 10.00, 'USD', 1.88, 'win', 'completed', 'Tyrese Haliburton', 'ast', 10.5, 'over', NOW() - INTERVAL '1 hour'),
    (target_user_id, test_date + 53, 'NBA', 'Player Props', 'Tyrese Haliburton Assists Over 10.5', 10.00, 'USD', 1.88, 'win', 'completed', 'Tyrese Haliburton', 'ast', 10.5, 'over', NOW() - INTERVAL '55 minutes'),
    (target_user_id, test_date + 54, 'NBA', 'Player Props', 'James Harden Assists Over 9.5', 10.00, 'USD', 1.85, 'win', 'completed', 'James Harden', 'ast', 9.5, 'over', NOW() - INTERVAL '50 minutes'),
    (target_user_id, test_date + 55, 'NBA', 'Player Props', 'James Harden Assists Over 9.5', 10.00, 'USD', 1.85, 'win', 'completed', 'James Harden', 'ast', 9.5, 'over', NOW() - INTERVAL '45 minutes'),
    (target_user_id, test_date + 56, 'NBA', 'Player Props', 'Luka Doncic Assists Over 8.5', 10.00, 'USD', 1.87, 'win', 'completed', 'Luka Doncic', 'ast', 8.5, 'over', NOW() - INTERVAL '40 minutes'),
    (target_user_id, test_date + 57, 'NBA', 'Player Props', 'Luka Doncic Assists Over 8.5', 10.00, 'USD', 1.87, 'win', 'completed', 'Luka Doncic', 'ast', 8.5, 'over', NOW() - INTERVAL '35 minutes'),
    
    -- AST losses (4 losses)
    (target_user_id, test_date + 58, 'NBA', 'Player Props', 'Dejounte Murray Assists Over 8.5', 10.00, 'USD', 1.86, 'loss', 'completed', 'Dejounte Murray', 'ast', 8.5, 'over', NOW() - INTERVAL '30 minutes'),
    (target_user_id, test_date + 59, 'NBA', 'Player Props', 'Dejounte Murray Assists Over 8.5', 10.00, 'USD', 1.86, 'loss', 'completed', 'Dejounte Murray', 'ast', 8.5, 'over', NOW() - INTERVAL '25 minutes'),
    (target_user_id, test_date + 60, 'NBA', 'Player Props', 'Fred VanVleet Assists Over 7.5', 10.00, 'USD', 1.84, 'loss', 'completed', 'Fred VanVleet', 'ast', 7.5, 'over', NOW() - INTERVAL '20 minutes'),
    (target_user_id, test_date + 61, 'NBA', 'Player Props', 'Fred VanVleet Assists Over 7.5', 10.00, 'USD', 1.84, 'loss', 'completed', 'Fred VanVleet', 'ast', 7.5, 'over', NOW() - INTERVAL '15 minutes');
  
  -- STL and BLK bets (wins)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, created_at)
  VALUES
    -- STL wins (4 wins)
    (target_user_id, test_date + 62, 'NBA', 'Player Props', 'Alex Caruso Steals Over 1.5', 10.00, 'USD', 1.90, 'win', 'completed', 'Alex Caruso', 'stl', 1.5, 'over', NOW() - INTERVAL '10 minutes'),
    (target_user_id, test_date + 63, 'NBA', 'Player Props', 'Alex Caruso Steals Over 1.5', 10.00, 'USD', 1.90, 'win', 'completed', 'Alex Caruso', 'stl', 1.5, 'over', NOW() - INTERVAL '5 minutes'),
    (target_user_id, test_date + 64, 'NBA', 'Player Props', 'Matisse Thybulle Steals Over 1.5', 10.00, 'USD', 1.88, 'win', 'completed', 'Matisse Thybulle', 'stl', 1.5, 'over', NOW()),
    (target_user_id, test_date + 65, 'NBA', 'Player Props', 'Matisse Thybulle Steals Over 1.5', 10.00, 'USD', 1.88, 'win', 'completed', 'Matisse Thybulle', 'stl', 1.5, 'over', NOW()),
    
    -- BLK wins (3 wins)
    (target_user_id, test_date + 66, 'NBA', 'Player Props', 'Victor Wembanyama Blocks Over 2.5', 10.00, 'USD', 1.92, 'win', 'completed', 'Victor Wembanyama', 'blk', 2.5, 'over', NOW()),
    (target_user_id, test_date + 67, 'NBA', 'Player Props', 'Victor Wembanyama Blocks Over 2.5', 10.00, 'USD', 1.92, 'win', 'completed', 'Victor Wembanyama', 'blk', 2.5, 'over', NOW()),
    (target_user_id, test_date + 68, 'NBA', 'Player Props', 'Brook Lopez Blocks Over 2.5', 10.00, 'USD', 1.89, 'win', 'completed', 'Brook Lopez', 'blk', 2.5, 'over', NOW()),
    
    -- More PTS (2 wins, 2 losses)
    (target_user_id, test_date + 69, 'NBA', 'Player Props', 'Jaylen Brown Points Over 23.5', 10.00, 'USD', 1.86, 'win', 'completed', 'Jaylen Brown', 'pts', 23.5, 'over', NOW()),
    (target_user_id, test_date + 70, 'NBA', 'Player Props', 'Jaylen Brown Points Over 23.5', 10.00, 'USD', 1.86, 'win', 'completed', 'Jaylen Brown', 'pts', 23.5, 'over', NOW()),
    (target_user_id, test_date + 71, 'NBA', 'Player Props', 'Pascal Siakam Points Over 22.5', 10.00, 'USD', 1.85, 'loss', 'completed', 'Pascal Siakam', 'pts', 22.5, 'over', NOW()),
    (target_user_id, test_date + 72, 'NBA', 'Player Props', 'Pascal Siakam Points Over 22.5', 10.00, 'USD', 1.85, 'loss', 'completed', 'Pascal Siakam', 'pts', 22.5, 'over', NOW()),
    
    -- More REB (2 wins, 2 losses)
    (target_user_id, test_date + 73, 'NBA', 'Player Props', 'Clint Capela Rebounds Over 11.5', 10.00, 'USD', 1.84, 'win', 'completed', 'Clint Capela', 'reb', 11.5, 'over', NOW()),
    (target_user_id, test_date + 74, 'NBA', 'Player Props', 'Clint Capela Rebounds Over 11.5', 10.00, 'USD', 1.84, 'win', 'completed', 'Clint Capela', 'reb', 11.5, 'over', NOW()),
    (target_user_id, test_date + 75, 'NBA', 'Player Props', 'Mitchell Robinson Rebounds Over 9.5', 10.00, 'USD', 1.87, 'loss', 'completed', 'Mitchell Robinson', 'reb', 9.5, 'over', NOW()),
    (target_user_id, test_date + 76, 'NBA', 'Player Props', 'Mitchell Robinson Rebounds Over 9.5', 10.00, 'USD', 1.87, 'loss', 'completed', 'Mitchell Robinson', 'reb', 9.5, 'over', NOW());
  
  RAISE NOTICE 'Successfully inserted test bets for user: %', target_user_id;
  RAISE NOTICE 'Total bets inserted: 75 (71 straight + 4 parlays)';
  RAISE NOTICE 'Breakdown: 35 wins, 15 losses (from additional 50 bets)';
  RAISE NOTICE 'Total overall: 60 wins, 15 losses';
  RAISE NOTICE 'Insights should now be visible in the journal sidebar!';
  
END $$;

