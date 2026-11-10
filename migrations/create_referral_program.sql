-- Refer-a-friend discount program

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_discount_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_coupon_percent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_referral_coupon_percent INTEGER,
  ADD COLUMN IF NOT EXISTS subscription_ended_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code_unique
  ON profiles (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_user_id
  ON profiles (referred_by_user_id);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'ended', 'disqualified')),
  stripe_subscription_id TEXT,
  card_fingerprint TEXT,
  activated_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  end_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status
  ON referrals (referrer_user_id, status);

CREATE INDEX IF NOT EXISTS idx_referrals_subscription
  ON referrals (stripe_subscription_id);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own referrals as referrer" ON referrals;
CREATE POLICY "Users can view own referrals as referrer" ON referrals
  FOR SELECT USING (auth.uid() = referrer_user_id);

DROP POLICY IF EXISTS "Users can view own referral as referred" ON referrals;
CREATE POLICY "Users can view own referral as referred" ON referrals
  FOR SELECT USING (auth.uid() = referred_user_id);

-- Service role / webhooks bypass RLS; no insert/update policies for clients.
