-- Migration to add 'pending' to the result check constraint
-- This allows bets to be in a 'pending' state before they are resolved

-- Drop the existing constraint
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_result_check;

-- Add the updated constraint that includes 'pending'
ALTER TABLE bets ADD CONSTRAINT bets_result_check 
  CHECK (result IN ('win', 'loss', 'void', 'pending'));

-- Verify the change
-- You can run: SELECT * FROM information_schema.check_constraints WHERE constraint_name = 'bets_result_check';
