-- migrations/add_journal_preferences_to_profiles.sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_journal_input TEXT DEFAULT 'money' CHECK (preferred_journal_input IN ('money', 'units')),
  ADD COLUMN IF NOT EXISTS preferred_currency TEXT DEFAULT 'USD' CHECK (preferred_currency IN ('USD', 'AUD', 'GBP', 'EUR'));

COMMENT ON COLUMN profiles.preferred_journal_input IS 'Preferred input method when adding bets to journal from dashboard: "money" for currency stake, "units" for unit-based stake';
COMMENT ON COLUMN profiles.preferred_currency IS 'Preferred currency for journal entries';

