-- Fix the specific bet that was incorrectly marked as loss
-- Bet ID: 458c6cd6-8eef-4847-afa2-63564bdd7e56
-- 
-- Legs:
-- - Coby White 4+ assists (actual: 4) → WIN (4 >= 4) ✅
-- - Vucevic over 8 rebounds (actual: 14) → WIN (14 > 8) ✅
-- - Lamelo 1+ made 3 pointer (actual: 3) → WIN (3 >= 1) ✅
-- - Lamelo 10+ points (actual: 16) → WIN (16 >= 10) ✅
-- 
-- All legs are wins, so parlay should be WIN

-- First, check the current state
SELECT 
  id,
  selection,
  result,
  status,
  date,
  created_at
FROM bets
WHERE id = '458c6cd6-8eef-4847-afa2-63564bdd7e56';

-- Update the bet to WIN
UPDATE bets
SET result = 'win'
WHERE id = '458c6cd6-8eef-4847-afa2-63564bdd7e56';

-- Verify the update
SELECT 
  id,
  selection,
  result,
  status
FROM bets
WHERE id = '458c6cd6-8eef-4847-afa2-63564bdd7e56';

