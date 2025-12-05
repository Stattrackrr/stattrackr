-- Add trial tracking column to profiles table
-- This prevents users from using multiple free trials

ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS has_used_trial BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_used_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_has_used_trial ON profiles(has_used_trial);

-- Update existing users who have had subscriptions to mark trial as used
-- This is a one-time migration for existing data
UPDATE profiles 
SET has_used_trial = TRUE 
WHERE stripe_subscription_id IS NOT NULL 
  AND has_used_trial IS FALSE;

