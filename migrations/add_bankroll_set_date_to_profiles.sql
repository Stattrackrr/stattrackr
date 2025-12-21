-- Add bankroll_set_date column to track when bankroll was first set
-- This allows calculating current bankroll by adding P&L only from bets after this date

ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS bankroll_set_date TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN profiles.bankroll_set_date IS 'The date when bankroll was first set. Only bets after this date affect the current bankroll calculation.';

