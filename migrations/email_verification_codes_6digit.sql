-- 6-digit email verification codes (custom OTP flow)
-- Used when signup sends a 6-digit code via Resend instead of Supabase's link.

-- Table: stores pending 6-digit codes for unconfirmed signups
CREATE TABLE IF NOT EXISTS public.email_verification_codes (
  email text PRIMARY KEY,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
);

-- RLS: only service role / backend should access this table.
-- No policies for anon/authenticated; APIs use service role.
ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;

-- Optional: restrict to service role only (Supabase typically does not allow anon to read this if no SELECT policy).
-- With RLS enabled and no GRANT SELECT to anon, only service role (bypasses RLS) can read/write.

COMMENT ON TABLE public.email_verification_codes IS 'Stores 6-digit OTP for email verification; used by /api/auth/signup-with-otp, verify-email-otp, resend-email-otp';

-- Function: get auth user id by email (for verify/resend when user_id is not in the row)
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE email = p_email LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_auth_user_id_by_email(text) IS 'Resolve auth.users.id from email; used by OTP verify/resend APIs.';
