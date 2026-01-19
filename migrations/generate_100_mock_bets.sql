-- ============================================
-- GENERATE 100 MOCK BETS FOR TESTING
-- Run this in Supabase SQL Editor
-- Email: bruhniggerlol101@gmail.com
-- Unit Size: $30
-- ============================================

DO $$
DECLARE
  target_user_id UUID;
  test_date DATE;
  base_stake DECIMAL(10,2) := 30.00;
  i INTEGER;
  player_names TEXT[] := ARRAY[
    'LeBron James', 'Stephen Curry', 'Kevin Durant', 'Luka Doncic', 'Jayson Tatum',
    'Nikola Jokic', 'Joel Embiid', 'Giannis Antetokounmpo', 'Devin Booker', 'Damian Lillard',
    'Anthony Davis', 'Kawhi Leonard', 'Paul George', 'Jimmy Butler', 'Bam Adebayo',
    'Trae Young', 'Ja Morant', 'Zion Williamson', 'Shai Gilgeous-Alexander', 'Tyrese Haliburton',
    'Jaylen Brown', 'Pascal Siakam', 'Dejounte Murray', 'Fred VanVleet', 'James Harden',
    'Russell Westbrook', 'Chris Paul', 'Rudy Gobert', 'Domantas Sabonis', 'Evan Mobley'
  ];
  stat_types TEXT[] := ARRAY['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'pr', 'pra', 'ra'];
  bookmakers TEXT[] := ARRAY['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet', 'BetRivers'];
BEGIN
  -- Find user by email
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = 'bruhniggerlol101@gmail.com';
  
  IF target_user_id IS NULL THEN
  END IF;
  
  -- Set base date (60 days ago to now for variety)
  test_date := CURRENT_DATE - 60;
  
  -- ============================================
  -- SINGLE BETS (70 bets total)
  -- ============================================
  
  -- PTS BETS (25 bets: 15 wins, 10 losses with some close misses)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, actual_value, game_date, bookmaker, created_at)
  VALUES
    -- Close misses by 0.5 (pain insights) - 5 bets
    (target_user_id, test_date + 1, 'NBA', 'Player Props', 'LeBron James Points Over 25.5', base_stake, 'USD', 1.91, 'loss', 'completed', 'LeBron James', 'pts', 25.5, 'over', 25.0, test_date + 1, bookmakers[1], NOW() - INTERVAL '59 days'),
    (target_user_id, test_date + 2, 'NBA', 'Player Props', 'Stephen Curry Points Over 28.5', base_stake, 'USD', 1.87, 'loss', 'completed', 'Stephen Curry', 'pts', 28.5, 'over', 28.0, test_date + 2, bookmakers[2], NOW() - INTERVAL '58 days'),
    (target_user_id, test_date + 3, 'NBA', 'Player Props', 'Jayson Tatum Points Over 26.5', base_stake, 'USD', 1.85, 'loss', 'completed', 'Jayson Tatum', 'pts', 26.5, 'over', 26.0, test_date + 3, bookmakers[3], NOW() - INTERVAL '57 days'),
    (target_user_id, test_date + 4, 'NBA', 'Player Props', 'Luka Doncic Points Over 30.5', base_stake, 'USD', 1.88, 'loss', 'completed', 'Luka Doncic', 'pts', 30.5, 'over', 30.0, test_date + 4, bookmakers[1], NOW() - INTERVAL '56 days'),
    (target_user_id, test_date + 5, 'NBA', 'Player Props', 'Kevin Durant Points Over 27.5', base_stake, 'USD', 1.89, 'loss', 'completed', 'Kevin Durant', 'pts', 27.5, 'over', 27.0, test_date + 5, bookmakers[2], NOW() - INTERVAL '55 days'),
    
    -- Regular losses (5 bets)
    (target_user_id, test_date + 6, 'NBA', 'Player Props', 'Joel Embiid Points Over 29.5', base_stake, 'USD', 1.86, 'loss', 'completed', 'Joel Embiid', 'pts', 29.5, 'over', 27.0, test_date + 6, bookmakers[4], NOW() - INTERVAL '54 days'),
    (target_user_id, test_date + 7, 'NBA', 'Player Props', 'Giannis Antetokounmpo Points Over 28.5', base_stake, 'USD', 1.87, 'loss', 'completed', 'Giannis Antetokounmpo', 'pts', 28.5, 'over', 26.0, test_date + 7, bookmakers[5], NOW() - INTERVAL '53 days'),
    (target_user_id, test_date + 8, 'NBA', 'Player Props', 'Devin Booker Points Over 27.5', base_stake, 'USD', 1.87, 'loss', 'completed', 'Devin Booker', 'pts', 27.5, 'over', 25.0, test_date + 8, bookmakers[6], NOW() - INTERVAL '52 days'),
    (target_user_id, test_date + 9, 'NBA', 'Player Props', 'Damian Lillard Points Over 28.5', base_stake, 'USD', 1.89, 'loss', 'completed', 'Damian Lillard', 'pts', 28.5, 'over', 26.0, test_date + 9, bookmakers[1], NOW() - INTERVAL '51 days'),
    (target_user_id, test_date + 10, 'NBA', 'Player Props', 'Ja Morant Points Over 25.5', base_stake, 'USD', 1.88, 'loss', 'completed', 'Ja Morant', 'pts', 25.5, 'over', 23.0, test_date + 10, bookmakers[2], NOW() - INTERVAL '50 days'),
    
    -- Wins (15 bets)
    (target_user_id, test_date + 11, 'NBA', 'Player Props', 'LeBron James Points Over 25.5', base_stake, 'USD', 1.91, 'win', 'completed', 'LeBron James', 'pts', 25.5, 'over', 28.0, test_date + 11, bookmakers[3], NOW() - INTERVAL '49 days'),
    (target_user_id, test_date + 12, 'NBA', 'Player Props', 'Stephen Curry Points Over 28.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Stephen Curry', 'pts', 28.5, 'over', 32.0, test_date + 12, bookmakers[4], NOW() - INTERVAL '48 days'),
    (target_user_id, test_date + 13, 'NBA', 'Player Props', 'Jayson Tatum Points Over 26.5', base_stake, 'USD', 1.85, 'win', 'completed', 'Jayson Tatum', 'pts', 26.5, 'over', 30.0, test_date + 13, bookmakers[5], NOW() - INTERVAL '47 days'),
    (target_user_id, test_date + 14, 'NBA', 'Player Props', 'Luka Doncic Points Over 30.5', base_stake, 'USD', 1.88, 'win', 'completed', 'Luka Doncic', 'pts', 30.5, 'over', 35.0, test_date + 14, bookmakers[6], NOW() - INTERVAL '46 days'),
    (target_user_id, test_date + 15, 'NBA', 'Player Props', 'Kevin Durant Points Over 27.5', base_stake, 'USD', 1.89, 'win', 'completed', 'Kevin Durant', 'pts', 27.5, 'over', 31.0, test_date + 15, bookmakers[1], NOW() - INTERVAL '45 days'),
    (target_user_id, test_date + 16, 'NBA', 'Player Props', 'Joel Embiid Points Over 29.5', base_stake, 'USD', 1.86, 'win', 'completed', 'Joel Embiid', 'pts', 29.5, 'over', 33.0, test_date + 16, bookmakers[2], NOW() - INTERVAL '44 days'),
    (target_user_id, test_date + 17, 'NBA', 'Player Props', 'Giannis Antetokounmpo Points Over 28.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Giannis Antetokounmpo', 'pts', 28.5, 'over', 32.0, test_date + 17, bookmakers[3], NOW() - INTERVAL '43 days'),
    (target_user_id, test_date + 18, 'NBA', 'Player Props', 'Devin Booker Points Over 27.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Devin Booker', 'pts', 27.5, 'over', 30.0, test_date + 18, bookmakers[4], NOW() - INTERVAL '42 days'),
    (target_user_id, test_date + 19, 'NBA', 'Player Props', 'Damian Lillard Points Over 28.5', base_stake, 'USD', 1.89, 'win', 'completed', 'Damian Lillard', 'pts', 28.5, 'over', 31.0, test_date + 19, bookmakers[5], NOW() - INTERVAL '41 days'),
    (target_user_id, test_date + 20, 'NBA', 'Player Props', 'Ja Morant Points Over 25.5', base_stake, 'USD', 1.88, 'win', 'completed', 'Ja Morant', 'pts', 25.5, 'over', 28.0, test_date + 20, bookmakers[6], NOW() - INTERVAL '40 days'),
    (target_user_id, test_date + 21, 'NBA', 'Player Props', 'Zion Williamson Points Over 24.5', base_stake, 'USD', 1.84, 'win', 'completed', 'Zion Williamson', 'pts', 24.5, 'over', 27.0, test_date + 21, bookmakers[1], NOW() - INTERVAL '39 days'),
    (target_user_id, test_date + 22, 'NBA', 'Player Props', 'Shai Gilgeous-Alexander Points Over 28.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Shai Gilgeous-Alexander', 'pts', 28.5, 'over', 32.0, test_date + 22, bookmakers[2], NOW() - INTERVAL '38 days'),
    (target_user_id, test_date + 23, 'NBA', 'Player Props', 'Tyrese Haliburton Points Over 20.5', base_stake, 'USD', 1.85, 'win', 'completed', 'Tyrese Haliburton', 'pts', 20.5, 'over', 24.0, test_date + 23, bookmakers[3], NOW() - INTERVAL '37 days'),
    (target_user_id, test_date + 24, 'NBA', 'Player Props', 'Jaylen Brown Points Over 23.5', base_stake, 'USD', 1.86, 'win', 'completed', 'Jaylen Brown', 'pts', 23.5, 'over', 26.0, test_date + 24, bookmakers[4], NOW() - INTERVAL '36 days'),
    (target_user_id, test_date + 25, 'NBA', 'Player Props', 'Pascal Siakam Points Over 22.5', base_stake, 'USD', 1.85, 'win', 'completed', 'Pascal Siakam', 'pts', 22.5, 'over', 25.0, test_date + 25, bookmakers[5], NOW() - INTERVAL '35 days');
  
  -- REB BETS (15 bets: 10 wins, 5 losses with close misses)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, actual_value, game_date, bookmaker, created_at)
  VALUES
    -- Close misses by 0.5 (2 bets)
    (target_user_id, test_date + 26, 'NBA', 'Player Props', 'Nikola Jokic Rebounds Over 11.5', base_stake, 'USD', 1.85, 'loss', 'completed', 'Nikola Jokic', 'reb', 11.5, 'over', 11.0, test_date + 26, bookmakers[6], NOW() - INTERVAL '34 days'),
    (target_user_id, test_date + 27, 'NBA', 'Player Props', 'Anthony Davis Rebounds Over 10.5', base_stake, 'USD', 1.83, 'loss', 'completed', 'Anthony Davis', 'reb', 10.5, 'over', 10.0, test_date + 27, bookmakers[1], NOW() - INTERVAL '33 days'),
    
    -- Regular losses (3 bets)
    (target_user_id, test_date + 28, 'NBA', 'Player Props', 'Rudy Gobert Rebounds Over 12.5', base_stake, 'USD', 1.88, 'loss', 'completed', 'Rudy Gobert', 'reb', 12.5, 'over', 10.0, test_date + 28, bookmakers[2], NOW() - INTERVAL '32 days'),
    (target_user_id, test_date + 29, 'NBA', 'Player Props', 'Bam Adebayo Rebounds Over 10.5', base_stake, 'USD', 1.85, 'loss', 'completed', 'Bam Adebayo', 'reb', 10.5, 'over', 9.0, test_date + 29, bookmakers[3], NOW() - INTERVAL '31 days'),
    (target_user_id, test_date + 30, 'NBA', 'Player Props', 'Domantas Sabonis Rebounds Over 12.5', base_stake, 'USD', 1.82, 'loss', 'completed', 'Domantas Sabonis', 'reb', 12.5, 'over', 11.0, test_date + 30, bookmakers[4], NOW() - INTERVAL '30 days'),
    
    -- Wins (10 bets)
    (target_user_id, test_date + 31, 'NBA', 'Player Props', 'Nikola Jokic Rebounds Over 11.5', base_stake, 'USD', 1.85, 'win', 'completed', 'Nikola Jokic', 'reb', 11.5, 'over', 13.0, test_date + 31, bookmakers[5], NOW() - INTERVAL '29 days'),
    (target_user_id, test_date + 32, 'NBA', 'Player Props', 'Anthony Davis Rebounds Over 10.5', base_stake, 'USD', 1.83, 'win', 'completed', 'Anthony Davis', 'reb', 10.5, 'over', 12.0, test_date + 32, bookmakers[6], NOW() - INTERVAL '28 days'),
    (target_user_id, test_date + 33, 'NBA', 'Player Props', 'Giannis Antetokounmpo Rebounds Over 11.5', base_stake, 'USD', 1.83, 'win', 'completed', 'Giannis Antetokounmpo', 'reb', 11.5, 'over', 13.0, test_date + 33, bookmakers[1], NOW() - INTERVAL '27 days'),
    (target_user_id, test_date + 34, 'NBA', 'Player Props', 'Bam Adebayo Rebounds Over 10.5', base_stake, 'USD', 1.85, 'win', 'completed', 'Bam Adebayo', 'reb', 10.5, 'over', 12.0, test_date + 34, bookmakers[2], NOW() - INTERVAL '26 days'),
    (target_user_id, test_date + 35, 'NBA', 'Player Props', 'Domantas Sabonis Rebounds Over 12.5', base_stake, 'USD', 1.82, 'win', 'completed', 'Domantas Sabonis', 'reb', 12.5, 'over', 14.0, test_date + 35, bookmakers[3], NOW() - INTERVAL '25 days'),
    (target_user_id, test_date + 36, 'NBA', 'Player Props', 'Evan Mobley Rebounds Over 9.5', base_stake, 'USD', 1.86, 'win', 'completed', 'Evan Mobley', 'reb', 9.5, 'over', 11.0, test_date + 36, bookmakers[4], NOW() - INTERVAL '24 days'),
    (target_user_id, test_date + 37, 'NBA', 'Player Props', 'Clint Capela Rebounds Over 11.5', base_stake, 'USD', 1.84, 'win', 'completed', 'Clint Capela', 'reb', 11.5, 'over', 13.0, test_date + 37, bookmakers[5], NOW() - INTERVAL '23 days'),
    (target_user_id, test_date + 38, 'NBA', 'Player Props', 'Jarrett Allen Rebounds Over 10.5', base_stake, 'USD', 1.84, 'win', 'completed', 'Jarrett Allen', 'reb', 10.5, 'over', 12.0, test_date + 38, bookmakers[6], NOW() - INTERVAL '22 days'),
    (target_user_id, test_date + 39, 'NBA', 'Player Props', 'Mitchell Robinson Rebounds Over 9.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Mitchell Robinson', 'reb', 9.5, 'over', 11.0, test_date + 39, bookmakers[1], NOW() - INTERVAL '21 days'),
    (target_user_id, test_date + 40, 'NBA', 'Player Props', 'Nikola Jokic Rebounds Over 11.5', base_stake, 'USD', 1.85, 'win', 'completed', 'Nikola Jokic', 'reb', 11.5, 'over', 12.0, test_date + 40, bookmakers[2], NOW() - INTERVAL '20 days');
  
  -- AST BETS (15 bets: 9 wins, 6 losses)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, actual_value, game_date, bookmaker, created_at)
  VALUES
    -- Close misses by 0.5 (2 bets)
    (target_user_id, test_date + 41, 'NBA', 'Player Props', 'Chris Paul Assists Over 9.5', base_stake, 'USD', 1.90, 'loss', 'completed', 'Chris Paul', 'ast', 9.5, 'over', 9.0, test_date + 41, bookmakers[3], NOW() - INTERVAL '19 days'),
    (target_user_id, test_date + 42, 'NBA', 'Player Props', 'Trae Young Assists Over 10.5', base_stake, 'USD', 1.87, 'loss', 'completed', 'Trae Young', 'ast', 10.5, 'over', 10.0, test_date + 42, bookmakers[4], NOW() - INTERVAL '18 days'),
    
    -- Regular losses (4 bets)
    (target_user_id, test_date + 43, 'NBA', 'Player Props', 'Russell Westbrook Assists Over 8.5', base_stake, 'USD', 1.85, 'loss', 'completed', 'Russell Westbrook', 'ast', 8.5, 'over', 7.0, test_date + 43, bookmakers[5], NOW() - INTERVAL '17 days'),
    (target_user_id, test_date + 44, 'NBA', 'Player Props', 'Dejounte Murray Assists Over 8.5', base_stake, 'USD', 1.86, 'loss', 'completed', 'Dejounte Murray', 'ast', 8.5, 'over', 7.0, test_date + 44, bookmakers[6], NOW() - INTERVAL '16 days'),
    (target_user_id, test_date + 45, 'NBA', 'Player Props', 'Fred VanVleet Assists Over 7.5', base_stake, 'USD', 1.84, 'loss', 'completed', 'Fred VanVleet', 'ast', 7.5, 'over', 6.0, test_date + 45, bookmakers[1], NOW() - INTERVAL '15 days'),
    (target_user_id, test_date + 46, 'NBA', 'Player Props', 'James Harden Assists Over 9.5', base_stake, 'USD', 1.85, 'loss', 'completed', 'James Harden', 'ast', 9.5, 'over', 8.0, test_date + 46, bookmakers[2], NOW() - INTERVAL '14 days'),
    
    -- Wins (9 bets)
    (target_user_id, test_date + 47, 'NBA', 'Player Props', 'Tyrese Haliburton Assists Over 10.5', base_stake, 'USD', 1.88, 'win', 'completed', 'Tyrese Haliburton', 'ast', 10.5, 'over', 12.0, test_date + 47, bookmakers[3], NOW() - INTERVAL '13 days'),
    (target_user_id, test_date + 48, 'NBA', 'Player Props', 'Luka Doncic Assists Over 8.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Luka Doncic', 'ast', 8.5, 'over', 10.0, test_date + 48, bookmakers[4], NOW() - INTERVAL '12 days'),
    (target_user_id, test_date + 49, 'NBA', 'Player Props', 'Trae Young Assists Over 10.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Trae Young', 'ast', 10.5, 'over', 12.0, test_date + 49, bookmakers[5], NOW() - INTERVAL '11 days'),
    (target_user_id, test_date + 50, 'NBA', 'Player Props', 'Chris Paul Assists Over 9.5', base_stake, 'USD', 1.90, 'win', 'completed', 'Chris Paul', 'ast', 9.5, 'over', 11.0, test_date + 50, bookmakers[6], NOW() - INTERVAL '10 days'),
    (target_user_id, test_date + 51, 'NBA', 'Player Props', 'James Harden Assists Over 9.5', base_stake, 'USD', 1.85, 'win', 'completed', 'James Harden', 'ast', 9.5, 'over', 10.0, test_date + 51, bookmakers[1], NOW() - INTERVAL '9 days'),
    (target_user_id, test_date + 52, 'NBA', 'Player Props', 'Russell Westbrook Assists Under 8.5', base_stake, 'USD', 1.85, 'win', 'completed', 'Russell Westbrook', 'ast', 8.5, 'under', 7.0, test_date + 52, bookmakers[2], NOW() - INTERVAL '8 days'),
    (target_user_id, test_date + 53, 'NBA', 'Player Props', 'Dejounte Murray Assists Over 8.5', base_stake, 'USD', 1.86, 'win', 'completed', 'Dejounte Murray', 'ast', 8.5, 'over', 9.0, test_date + 53, bookmakers[3], NOW() - INTERVAL '7 days'),
    (target_user_id, test_date + 54, 'NBA', 'Player Props', 'Fred VanVleet Assists Over 7.5', base_stake, 'USD', 1.84, 'win', 'completed', 'Fred VanVleet', 'ast', 7.5, 'over', 8.0, test_date + 54, bookmakers[4], NOW() - INTERVAL '6 days'),
    (target_user_id, test_date + 55, 'NBA', 'Player Props', 'Tyrese Haliburton Assists Over 10.5', base_stake, 'USD', 1.88, 'win', 'completed', 'Tyrese Haliburton', 'ast', 10.5, 'over', 11.0, test_date + 55, bookmakers[5], NOW() - INTERVAL '5 days');
  
  -- STL/BLK/FG3M BETS (15 bets: 10 wins, 5 losses)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, player_name, stat_type, line, over_under, actual_value, game_date, bookmaker, created_at)
  VALUES
    -- Close misses by 0.5 (2 bets)
    (target_user_id, test_date + 56, 'NBA', 'Player Props', 'Alex Caruso Steals Over 1.5', base_stake, 'USD', 1.90, 'loss', 'completed', 'Alex Caruso', 'stl', 1.5, 'over', 1.0, test_date + 56, bookmakers[6], NOW() - INTERVAL '4 days'),
    (target_user_id, test_date + 57, 'NBA', 'Player Props', 'Matisse Thybulle Steals Over 1.5', base_stake, 'USD', 1.88, 'loss', 'completed', 'Matisse Thybulle', 'stl', 1.5, 'over', 1.0, test_date + 57, bookmakers[1], NOW() - INTERVAL '3 days'),
    
    -- Regular losses (3 bets)
    (target_user_id, test_date + 58, 'NBA', 'Player Props', 'Victor Wembanyama Blocks Over 2.5', base_stake, 'USD', 1.92, 'loss', 'completed', 'Victor Wembanyama', 'blk', 2.5, 'over', 1.0, test_date + 58, bookmakers[2], NOW() - INTERVAL '2 days'),
    (target_user_id, test_date + 59, 'NBA', 'Player Props', 'Brook Lopez Blocks Over 2.5', base_stake, 'USD', 1.89, 'loss', 'completed', 'Brook Lopez', 'blk', 2.5, 'over', 2.0, test_date + 59, bookmakers[3], NOW() - INTERVAL '1 day'),
    (target_user_id, test_date + 60, 'NBA', 'Player Props', 'Stephen Curry 3-Pointers Made Over 4.5', base_stake, 'USD', 1.88, 'loss', 'completed', 'Stephen Curry', 'fg3m', 4.5, 'over', 3.0, test_date + 60, bookmakers[4], NOW()),
    
    -- Wins (10 bets)
    (target_user_id, test_date + 61, 'NBA', 'Player Props', 'Alex Caruso Steals Over 1.5', base_stake, 'USD', 1.90, 'win', 'completed', 'Alex Caruso', 'stl', 1.5, 'over', 2.0, test_date + 61, bookmakers[5], NOW()),
    (target_user_id, test_date + 62, 'NBA', 'Player Props', 'Matisse Thybulle Steals Over 1.5', base_stake, 'USD', 1.88, 'win', 'completed', 'Matisse Thybulle', 'stl', 1.5, 'over', 3.0, test_date + 62, bookmakers[6], NOW()),
    (target_user_id, test_date + 63, 'NBA', 'Player Props', 'Victor Wembanyama Blocks Over 2.5', base_stake, 'USD', 1.92, 'win', 'completed', 'Victor Wembanyama', 'blk', 2.5, 'over', 3.0, test_date + 63, bookmakers[1], NOW()),
    (target_user_id, test_date + 64, 'NBA', 'Player Props', 'Brook Lopez Blocks Over 2.5', base_stake, 'USD', 1.89, 'win', 'completed', 'Brook Lopez', 'blk', 2.5, 'over', 4.0, test_date + 64, bookmakers[2], NOW()),
    (target_user_id, test_date + 65, 'NBA', 'Player Props', 'Stephen Curry 3-Pointers Made Over 4.5', base_stake, 'USD', 1.88, 'win', 'completed', 'Stephen Curry', 'fg3m', 4.5, 'over', 6.0, test_date + 65, bookmakers[3], NOW()),
    (target_user_id, test_date + 66, 'NBA', 'Player Props', 'Klay Thompson 3-Pointers Made Over 3.5', base_stake, 'USD', 1.87, 'win', 'completed', 'Klay Thompson', 'fg3m', 3.5, 'over', 5.0, test_date + 66, bookmakers[4], NOW()),
    (target_user_id, test_date + 67, 'NBA', 'Player Props', 'Damian Lillard 3-Pointers Made Over 3.5', base_stake, 'USD', 1.89, 'win', 'completed', 'Damian Lillard', 'fg3m', 3.5, 'over', 4.0, test_date + 67, bookmakers[5], NOW()),
    (target_user_id, test_date + 68, 'NBA', 'Player Props', 'Donovan Mitchell Steals Over 1.5', base_stake, 'USD', 1.86, 'win', 'completed', 'Donovan Mitchell', 'stl', 1.5, 'over', 2.0, test_date + 68, bookmakers[6], NOW()),
    (target_user_id, test_date + 69, 'NBA', 'Player Props', 'Jrue Holiday Steals Over 1.5', base_stake, 'USD', 1.88, 'win', 'completed', 'Jrue Holiday', 'stl', 1.5, 'over', 2.0, test_date + 69, bookmakers[1], NOW()),
    (target_user_id, test_date + 70, 'NBA', 'Player Props', 'Myles Turner Blocks Over 2.5', base_stake, 'USD', 1.90, 'win', 'completed', 'Myles Turner', 'blk', 2.5, 'over', 3.0, test_date + 70, bookmakers[2], NOW());
  
  -- ============================================
  -- PARLAY BETS (30 bets total)
  -- ============================================
  
  -- 2-LEG PARLAYS (15 bets: 8 wins, 7 losses - 4 lost by 1 leg)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, parlay_legs, bookmaker, created_at)
  VALUES
    -- Lost by 1 leg (4 bets - pain insights)
    (target_user_id, test_date + 71, 'NBA', 'Parlay (2 legs)', 'Parlay: LeBron James Points Over 25.5 + Nikola Jokic Rebounds Over 11.5', base_stake, 'USD', 3.50, 'loss', 'completed', 
     '[{"playerName": "LeBron James", "statType": "pts", "line": 25.5, "overUnder": "over", "won": false}, {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[3], NOW() - INTERVAL '1 day'),
    (target_user_id, test_date + 72, 'NBA', 'Parlay (2 legs)', 'Parlay: Stephen Curry Points Over 28.5 + Kevin Durant Points Over 27.5', base_stake, 'USD', 3.45, 'loss', 'completed',
     '[{"playerName": "Stephen Curry", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}, {"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[4], NOW() - INTERVAL '23 hours'),
    (target_user_id, test_date + 73, 'NBA', 'Parlay (2 legs)', 'Parlay: Anthony Davis Rebounds Over 10.5 + Trae Young Assists Over 10.5', base_stake, 'USD', 3.40, 'loss', 'completed',
     '[{"playerName": "Anthony Davis", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true}, {"playerName": "Trae Young", "statType": "ast", "line": 10.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[5], NOW() - INTERVAL '22 hours'),
    (target_user_id, test_date + 74, 'NBA', 'Parlay (2 legs)', 'Parlay: Jayson Tatum Points Over 26.5 + Chris Paul Assists Over 9.5', base_stake, 'USD', 3.48, 'loss', 'completed',
     '[{"playerName": "Jayson Tatum", "statType": "pts", "line": 26.5, "overUnder": "over", "won": true}, {"playerName": "Chris Paul", "statType": "ast", "line": 9.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[6], NOW() - INTERVAL '21 hours'),
    
    -- Regular losses (3 bets - lost by 2 legs)
    (target_user_id, test_date + 75, 'NBA', 'Parlay (2 legs)', 'Parlay: Joel Embiid Points Over 29.5 + Giannis Antetokounmpo Points Over 28.5', base_stake, 'USD', 3.42, 'loss', 'completed',
     '[{"playerName": "Joel Embiid", "statType": "pts", "line": 29.5, "overUnder": "over", "won": false}, {"playerName": "Giannis Antetokounmpo", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[1], NOW() - INTERVAL '20 hours'),
    (target_user_id, test_date + 76, 'NBA', 'Parlay (2 legs)', 'Parlay: Devin Booker Points Over 27.5 + Damian Lillard Points Over 28.5', base_stake, 'USD', 3.46, 'loss', 'completed',
     '[{"playerName": "Devin Booker", "statType": "pts", "line": 27.5, "overUnder": "over", "won": false}, {"playerName": "Damian Lillard", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[2], NOW() - INTERVAL '19 hours'),
    (target_user_id, test_date + 77, 'NBA', 'Parlay (2 legs)', 'Parlay: Ja Morant Points Over 25.5 + Zion Williamson Points Over 24.5', base_stake, 'USD', 3.38, 'loss', 'completed',
     '[{"playerName": "Ja Morant", "statType": "pts", "line": 25.5, "overUnder": "over", "won": false}, {"playerName": "Zion Williamson", "statType": "pts", "line": 24.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[3], NOW() - INTERVAL '18 hours'),
    
    -- Wins (8 bets)
    (target_user_id, test_date + 78, 'NBA', 'Parlay (2 legs)', 'Parlay: Kevin Durant Points Over 27.5 + Nikola Jokic Rebounds Over 11.5', base_stake, 'USD', 3.45, 'win', 'completed',
     '[{"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}, {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[4], NOW() - INTERVAL '17 hours'),
    (target_user_id, test_date + 79, 'NBA', 'Parlay (2 legs)', 'Parlay: Luka Doncic Points Over 30.5 + Anthony Davis Rebounds Over 10.5', base_stake, 'USD', 3.40, 'win', 'completed',
     '[{"playerName": "Luka Doncic", "statType": "pts", "line": 30.5, "overUnder": "over", "won": true}, {"playerName": "Anthony Davis", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[5], NOW() - INTERVAL '16 hours'),
    (target_user_id, test_date + 80, 'NBA', 'Parlay (2 legs)', 'Parlay: Jayson Tatum Points Over 26.5 + Giannis Antetokounmpo Rebounds Over 11.5', base_stake, 'USD', 3.38, 'win', 'completed',
     '[{"playerName": "Jayson Tatum", "statType": "pts", "line": 26.5, "overUnder": "over", "won": true}, {"playerName": "Giannis Antetokounmpo", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[6], NOW() - INTERVAL '15 hours'),
    (target_user_id, test_date + 81, 'NBA', 'Parlay (2 legs)', 'Parlay: Tyrese Haliburton Assists Over 10.5 + Stephen Curry 3-Pointers Made Over 4.5', base_stake, 'USD', 3.52, 'win', 'completed',
     '[{"playerName": "Tyrese Haliburton", "statType": "ast", "line": 10.5, "overUnder": "over", "won": true}, {"playerName": "Stephen Curry", "statType": "fg3m", "line": 4.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[1], NOW() - INTERVAL '14 hours'),
    (target_user_id, test_date + 82, 'NBA', 'Parlay (2 legs)', 'Parlay: LeBron James Points Over 25.5 + Nikola Jokic Rebounds Over 11.5', base_stake, 'USD', 3.50, 'win', 'completed',
     '[{"playerName": "LeBron James", "statType": "pts", "line": 25.5, "overUnder": "over", "won": true}, {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[2], NOW() - INTERVAL '13 hours'),
    (target_user_id, test_date + 83, 'NBA', 'Parlay (2 legs)', 'Parlay: Shai Gilgeous-Alexander Points Over 28.5 + Domantas Sabonis Rebounds Over 12.5', base_stake, 'USD', 3.36, 'win', 'completed',
     '[{"playerName": "Shai Gilgeous-Alexander", "statType": "pts", "line": 28.5, "overUnder": "over", "won": true}, {"playerName": "Domantas Sabonis", "statType": "reb", "line": 12.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[3], NOW() - INTERVAL '12 hours'),
    (target_user_id, test_date + 84, 'NBA', 'Parlay (2 legs)', 'Parlay: Jaylen Brown Points Over 23.5 + Bam Adebayo Rebounds Over 10.5', base_stake, 'USD', 3.42, 'win', 'completed',
     '[{"playerName": "Jaylen Brown", "statType": "pts", "line": 23.5, "overUnder": "over", "won": true}, {"playerName": "Bam Adebayo", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[4], NOW() - INTERVAL '11 hours'),
    (target_user_id, test_date + 85, 'NBA', 'Parlay (2 legs)', 'Parlay: Pascal Siakam Points Over 22.5 + Evan Mobley Rebounds Over 9.5', base_stake, 'USD', 3.44, 'win', 'completed',
     '[{"playerName": "Pascal Siakam", "statType": "pts", "line": 22.5, "overUnder": "over", "won": true}, {"playerName": "Evan Mobley", "statType": "reb", "line": 9.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[5], NOW() - INTERVAL '10 hours');
  
  -- 3-LEG PARLAYS (10 bets: 4 wins, 6 losses - 3 lost by 1 leg)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, parlay_legs, bookmaker, created_at)
  VALUES
    -- Lost by 1 leg (3 bets - pain insights)
    (target_user_id, test_date + 86, 'NBA', 'Parlay (3 legs)', 'Parlay: Stephen Curry Points Over 28.5 + Kevin Durant Points Over 27.5 + Chris Paul Assists Over 9.5', base_stake, 'USD', 6.20, 'loss', 'completed',
     '[{"playerName": "Stephen Curry", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}, {"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}, {"playerName": "Chris Paul", "statType": "ast", "line": 9.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[6], NOW() - INTERVAL '9 hours'),
    (target_user_id, test_date + 87, 'NBA', 'Parlay (3 legs)', 'Parlay: LeBron James Points Over 25.5 + Nikola Jokic Rebounds Over 11.5 + Kevin Durant Points Over 27.5', base_stake, 'USD', 6.50, 'loss', 'completed',
     '[{"playerName": "LeBron James", "statType": "pts", "line": 25.5, "overUnder": "over", "won": true}, {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}, {"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[1], NOW() - INTERVAL '8 hours'),
    (target_user_id, test_date + 88, 'NBA', 'Parlay (3 legs)', 'Parlay: Jayson Tatum Points Over 26.5 + Anthony Davis Rebounds Over 10.5 + Tyrese Haliburton Assists Over 10.5', base_stake, 'USD', 6.15, 'loss', 'completed',
     '[{"playerName": "Jayson Tatum", "statType": "pts", "line": 26.5, "overUnder": "over", "won": true}, {"playerName": "Anthony Davis", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true}, {"playerName": "Tyrese Haliburton", "statType": "ast", "line": 10.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[2], NOW() - INTERVAL '7 hours'),
    
    -- Regular losses (3 bets - lost by 2+ legs)
    (target_user_id, test_date + 89, 'NBA', 'Parlay (3 legs)', 'Parlay: Joel Embiid Points Over 29.5 + Giannis Antetokounmpo Points Over 28.5 + Devin Booker Points Over 27.5', base_stake, 'USD', 6.25, 'loss', 'completed',
     '[{"playerName": "Joel Embiid", "statType": "pts", "line": 29.5, "overUnder": "over", "won": false}, {"playerName": "Giannis Antetokounmpo", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}, {"playerName": "Devin Booker", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[3], NOW() - INTERVAL '6 hours'),
    (target_user_id, test_date + 90, 'NBA', 'Parlay (3 legs)', 'Parlay: Damian Lillard Points Over 28.5 + Ja Morant Points Over 25.5 + Zion Williamson Points Over 24.5', base_stake, 'USD', 6.30, 'loss', 'completed',
     '[{"playerName": "Damian Lillard", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}, {"playerName": "Ja Morant", "statType": "pts", "line": 25.5, "overUnder": "over", "won": false}, {"playerName": "Zion Williamson", "statType": "pts", "line": 24.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[4], NOW() - INTERVAL '5 hours'),
    (target_user_id, test_date + 91, 'NBA', 'Parlay (3 legs)', 'Parlay: Luka Doncic Points Over 30.5 + Trae Young Assists Over 10.5 + Chris Paul Assists Over 9.5', base_stake, 'USD', 6.40, 'loss', 'completed',
     '[{"playerName": "Luka Doncic", "statType": "pts", "line": 30.5, "overUnder": "over", "won": true}, {"playerName": "Trae Young", "statType": "ast", "line": 10.5, "overUnder": "over", "won": false}, {"playerName": "Chris Paul", "statType": "ast", "line": 9.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[5], NOW() - INTERVAL '4 hours'),
    
    -- Wins (4 bets)
    (target_user_id, test_date + 92, 'NBA', 'Parlay (3 legs)', 'Parlay: Kevin Durant Points Over 27.5 + Nikola Jokic Rebounds Over 11.5 + Tyrese Haliburton Assists Over 10.5', base_stake, 'USD', 6.35, 'win', 'completed',
     '[{"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}, {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}, {"playerName": "Tyrese Haliburton", "statType": "ast", "line": 10.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[6], NOW() - INTERVAL '3 hours'),
    (target_user_id, test_date + 93, 'NBA', 'Parlay (3 legs)', 'Parlay: Luka Doncic Points Over 30.5 + Anthony Davis Rebounds Over 10.5 + Stephen Curry 3-Pointers Made Over 4.5', base_stake, 'USD', 6.28, 'win', 'completed',
     '[{"playerName": "Luka Doncic", "statType": "pts", "line": 30.5, "overUnder": "over", "won": true}, {"playerName": "Anthony Davis", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true}, {"playerName": "Stephen Curry", "statType": "fg3m", "line": 4.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[1], NOW() - INTERVAL '2 hours'),
    (target_user_id, test_date + 94, 'NBA', 'Parlay (3 legs)', 'Parlay: Jayson Tatum Points Over 26.5 + Giannis Antetokounmpo Rebounds Over 11.5 + James Harden Assists Over 9.5', base_stake, 'USD', 6.22, 'win', 'completed',
     '[{"playerName": "Jayson Tatum", "statType": "pts", "line": 26.5, "overUnder": "over", "won": true}, {"playerName": "Giannis Antetokounmpo", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}, {"playerName": "James Harden", "statType": "ast", "line": 9.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[2], NOW() - INTERVAL '1 hour'),
    (target_user_id, test_date + 95, 'NBA', 'Parlay (3 legs)', 'Parlay: Shai Gilgeous-Alexander Points Over 28.5 + Domantas Sabonis Rebounds Over 12.5 + Luka Doncic Assists Over 8.5', base_stake, 'USD', 6.18, 'win', 'completed',
     '[{"playerName": "Shai Gilgeous-Alexander", "statType": "pts", "line": 28.5, "overUnder": "over", "won": true}, {"playerName": "Domantas Sabonis", "statType": "reb", "line": 12.5, "overUnder": "over", "won": true}, {"playerName": "Luka Doncic", "statType": "ast", "line": 8.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[3], NOW());
  
  -- 4-LEG PARLAYS (5 bets: 2 wins, 3 losses - 2 lost by 1 leg)
  INSERT INTO bets (user_id, date, sport, market, selection, stake, currency, odds, result, status, parlay_legs, bookmaker, created_at)
  VALUES
    -- Lost by 1 leg (2 bets - pain insights)
    (target_user_id, test_date + 96, 'NBA', 'Parlay (4 legs)', 'Parlay: LeBron James Points Over 25.5 + Nikola Jokic Rebounds Over 11.5 + Kevin Durant Points Over 27.5 + Tyrese Haliburton Assists Over 10.5', base_stake, 'USD', 12.50, 'loss', 'completed',
     '[{"playerName": "LeBron James", "statType": "pts", "line": 25.5, "overUnder": "over", "won": false}, {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}, {"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}, {"playerName": "Tyrese Haliburton", "statType": "ast", "line": 10.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[4], NOW()),
    (target_user_id, test_date + 97, 'NBA', 'Parlay (4 legs)', 'Parlay: Stephen Curry Points Over 28.5 + Anthony Davis Rebounds Over 10.5 + Jayson Tatum Points Over 26.5 + Luka Doncic Assists Over 8.5', base_stake, 'USD', 12.80, 'loss', 'completed',
     '[{"playerName": "Stephen Curry", "statType": "pts", "line": 28.5, "overUnder": "over", "won": true}, {"playerName": "Anthony Davis", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true}, {"playerName": "Jayson Tatum", "statType": "pts", "line": 26.5, "overUnder": "over", "won": true}, {"playerName": "Luka Doncic", "statType": "ast", "line": 8.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[5], NOW()),
    
    -- Regular loss (1 bet - lost by 2+ legs)
    (target_user_id, test_date + 98, 'NBA', 'Parlay (4 legs)', 'Parlay: Joel Embiid Points Over 29.5 + Giannis Antetokounmpo Points Over 28.5 + Devin Booker Points Over 27.5 + Damian Lillard Points Over 28.5', base_stake, 'USD', 12.60, 'loss', 'completed',
     '[{"playerName": "Joel Embiid", "statType": "pts", "line": 29.5, "overUnder": "over", "won": false}, {"playerName": "Giannis Antetokounmpo", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}, {"playerName": "Devin Booker", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}, {"playerName": "Damian Lillard", "statType": "pts", "line": 28.5, "overUnder": "over", "won": false}]'::jsonb,
     bookmakers[6], NOW()),
    
    -- Wins (2 bets)
    (target_user_id, test_date + 99, 'NBA', 'Parlay (4 legs)', 'Parlay: Kevin Durant Points Over 27.5 + Nikola Jokic Rebounds Over 11.5 + Tyrese Haliburton Assists Over 10.5 + Stephen Curry 3-Pointers Made Over 4.5', base_stake, 'USD', 12.75, 'win', 'completed',
     '[{"playerName": "Kevin Durant", "statType": "pts", "line": 27.5, "overUnder": "over", "won": true}, {"playerName": "Nikola Jokic", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}, {"playerName": "Tyrese Haliburton", "statType": "ast", "line": 10.5, "overUnder": "over", "won": true}, {"playerName": "Stephen Curry", "statType": "fg3m", "line": 4.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[1], NOW()),
    (target_user_id, test_date + 100, 'NBA', 'Parlay (4 legs)', 'Parlay: Luka Doncic Points Over 30.5 + Anthony Davis Rebounds Over 10.5 + Jayson Tatum Points Over 26.5 + Giannis Antetokounmpo Rebounds Over 11.5', base_stake, 'USD', 12.40, 'win', 'completed',
     '[{"playerName": "Luka Doncic", "statType": "pts", "line": 30.5, "overUnder": "over", "won": true}, {"playerName": "Anthony Davis", "statType": "reb", "line": 10.5, "overUnder": "over", "won": true}, {"playerName": "Jayson Tatum", "statType": "pts", "line": 26.5, "overUnder": "over", "won": true}, {"playerName": "Giannis Antetokounmpo", "statType": "reb", "line": 11.5, "overUnder": "over", "won": true}]'::jsonb,
     bookmakers[2], NOW());
  
  RAISE NOTICE 'Successfully inserted 100 mock bets for user: %', target_user_id;
  RAISE NOTICE 'Breakdown:';
  RAISE NOTICE '  - Single bets: 70 (44 wins, 26 losses)';
  RAISE NOTICE '  - 2-leg parlays: 15 (8 wins, 7 losses - 4 lost by 1 leg)';
  RAISE NOTICE '  - 3-leg parlays: 10 (4 wins, 6 losses - 3 lost by 1 leg)';
  RAISE NOTICE '  - 4-leg parlays: 5 (2 wins, 3 losses - 2 lost by 1 leg)';
  RAISE NOTICE '  - Total: 100 bets (58 wins, 42 losses)';
  RAISE NOTICE '  - Pain Insights: 9 parlays lost by 1 leg, 9 single bets missed by 0.5';
  RAISE NOTICE '  - Unit size: $30.00';
  
END $$;

