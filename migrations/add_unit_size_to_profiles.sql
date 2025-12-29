-- Add unit_size column to profiles table for unit-based betting tracking
-- This allows users to set their unit size (e.g., 1 unit = $100)

ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS unit_size DECIMAL(10,2);

-- Add comment
COMMENT ON COLUMN profiles.unit_size IS 'The dollar amount that represents 1 unit for this user (e.g., 100.00 means 1 unit = $100)';







