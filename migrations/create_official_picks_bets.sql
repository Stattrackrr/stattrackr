-- Official StatTrackr picks record (shared across all premium chat members).
-- Admin (admin@stattrackr.co) can insert/update/delete; everyone with chat premium can read.

CREATE TABLE IF NOT EXISTS public.official_picks_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  sport TEXT NOT NULL DEFAULT 'NBA',
  market TEXT,
  selection TEXT NOT NULL,
  stake_units DECIMAL(10, 2) NOT NULL DEFAULT 1 CHECK (stake_units > 0),
  odds DECIMAL(10, 3) NOT NULL CHECK (odds > 1),
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('win', 'loss', 'void', 'pending')),
  bookmaker TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_official_picks_bets_date
  ON public.official_picks_bets(date DESC);

CREATE INDEX IF NOT EXISTS idx_official_picks_bets_result
  ON public.official_picks_bets(result);

ALTER TABLE public.official_picks_bets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Premium users can read official picks bets" ON public.official_picks_bets;
CREATE POLICY "Premium users can read official picks bets"
  ON public.official_picks_bets
  FOR SELECT
  TO authenticated
  USING (public.chat_user_has_premium_access(auth.uid()));

DROP POLICY IF EXISTS "Admin can insert official picks bets" ON public.official_picks_bets;
CREATE POLICY "Admin can insert official picks bets"
  ON public.official_picks_bets
  FOR INSERT
  TO authenticated
  WITH CHECK (public.chat_user_is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin can update official picks bets" ON public.official_picks_bets;
CREATE POLICY "Admin can update official picks bets"
  ON public.official_picks_bets
  FOR UPDATE
  TO authenticated
  USING (public.chat_user_is_admin(auth.uid()))
  WITH CHECK (public.chat_user_is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admin can delete official picks bets" ON public.official_picks_bets;
CREATE POLICY "Admin can delete official picks bets"
  ON public.official_picks_bets
  FOR DELETE
  TO authenticated
  USING (public.chat_user_is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_official_picks_bets_updated_at ON public.official_picks_bets;
CREATE TRIGGER update_official_picks_bets_updated_at
  BEFORE UPDATE ON public.official_picks_bets
  FOR EACH ROW
  EXECUTE PROCEDURE public.update_updated_at_column();
