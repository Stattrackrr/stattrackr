-- Add first_name, last_name, username, phone to profiles so they appear as columns in Supabase.
-- Sign up and account updates already save these to auth.users.raw_user_meta_data (User Metadata);
-- this migration also stores them in profiles for easy viewing in Table Editor and for queries.

-- 1. Add columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN profiles.first_name IS 'User first name from sign up / account settings';
COMMENT ON COLUMN profiles.last_name IS 'User last name from sign up / account settings';
COMMENT ON COLUMN profiles.username IS 'User username from sign up / account settings';
COMMENT ON COLUMN profiles.phone IS 'User phone from sign up / account settings';

-- 2. Update handle_new_user to copy first_name, last_name, username, phone from raw_user_meta_data
--    and set full_name from first+last when full_name is not provided
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  fn TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), '');
  ln TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), '');
  un TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), '');
  ph TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), '');
  fname TEXT := NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), '');
BEGIN
  INSERT INTO public.profiles (id, email, full_name, first_name, last_name, username, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(fname, NULLIF(TRIM(fn || ' ' || ln), '')),
    fn,
    ln,
    un,
    ph
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Backfill existing profiles from auth.users.raw_user_meta_data
UPDATE public.profiles p
SET
  first_name = NULLIF(TRIM(u.raw_user_meta_data->>'first_name'), ''),
  last_name = NULLIF(TRIM(u.raw_user_meta_data->>'last_name'), ''),
  username = NULLIF(TRIM(u.raw_user_meta_data->>'username'), ''),
  phone = NULLIF(TRIM(u.raw_user_meta_data->>'phone'), ''),
  full_name = COALESCE(
    NULLIF(TRIM(p.full_name), ''),
    NULLIF(TRIM(
      (u.raw_user_meta_data->>'first_name') || ' ' || (u.raw_user_meta_data->>'last_name')
    ), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), '')
  ),
  updated_at = NOW()
FROM auth.users u
WHERE p.id = u.id
  AND (
    u.raw_user_meta_data ? 'first_name'
    OR u.raw_user_meta_data ? 'last_name'
    OR u.raw_user_meta_data ? 'username'
    OR u.raw_user_meta_data ? 'phone'
    OR u.raw_user_meta_data ? 'full_name'
  );
