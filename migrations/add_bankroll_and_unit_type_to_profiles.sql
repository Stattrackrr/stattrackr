-- Add bankroll, bankroll_currency, and unit_type columns to profiles table for unit-based betting tracking
-- This allows users to set their bankroll and choose between dollar-based or percentage-based units

ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS bankroll DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS bankroll_currency TEXT CHECK (bankroll_currency IN ('USD', 'AUD', 'GBP', 'EUR')) DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS unit_type TEXT CHECK (unit_type IN ('value', 'percent'));

-- Add comments
COMMENT ON COLUMN profiles.bankroll IS 'The total bankroll amount for this user';
COMMENT ON COLUMN profiles.bankroll_currency IS 'The currency for the bankroll (USD, AUD, GBP, EUR)';
COMMENT ON COLUMN profiles.unit_type IS 'The type of unit calculation: "value" for dollar-based units, "percent" for percentage-based units';

