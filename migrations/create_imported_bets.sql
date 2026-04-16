-- Add import metadata to final journal bets.
ALTER TABLE bets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS source_book TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS source_external_id TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS import_batch_id UUID;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_bets_source ON bets(source);
CREATE INDEX IF NOT EXISTS idx_bets_source_book ON bets(source_book);
CREATE INDEX IF NOT EXISTS idx_bets_import_batch_id ON bets(import_batch_id);

COMMENT ON COLUMN bets.source IS 'How the bet entered the journal: manual, extension, csv, email, api.';
COMMENT ON COLUMN bets.source_book IS 'Original sportsbook that produced the import.';
COMMENT ON COLUMN bets.source_external_id IS 'Sportsbook receipt/ticket id when available.';
COMMENT ON COLUMN bets.import_batch_id IS 'Batch id linking final bets to a sportsbook import session.';
COMMENT ON COLUMN bets.captured_at IS 'When the import pipeline captured the bet from the sportsbook surface.';

-- Stage incoming sportsbook imports before promotion to final bets rows.
CREATE TABLE IF NOT EXISTS imported_bets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'extension',
  source_book TEXT NOT NULL,
  source_external_id TEXT,
  source_page_url TEXT,
  import_batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'approved', 'rejected', 'duplicate', 'failed')),
  normalized_bet JSONB NOT NULL,
  raw_payload JSONB,
  parse_notes TEXT,
  error_message TEXT,
  promoted_bet_id UUID REFERENCES bets(id) ON DELETE SET NULL,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_bets_user_dedupe
  ON imported_bets(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_imported_bets_user_status_created
  ON imported_bets(user_id, review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_imported_bets_batch
  ON imported_bets(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_imported_bets_promoted_bet_id
  ON imported_bets(promoted_bet_id);

COMMENT ON TABLE imported_bets IS 'Staging queue for sportsbook and external journal imports.';
COMMENT ON COLUMN imported_bets.normalized_bet IS 'Validated add-bet-compatible payload ready for promotion into bets.';
COMMENT ON COLUMN imported_bets.raw_payload IS 'Original raw payload captured from extension/parser.';

ALTER TABLE imported_bets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own imported bets" ON imported_bets;
CREATE POLICY "Users can view their own imported bets" ON imported_bets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own imported bets" ON imported_bets;
CREATE POLICY "Users can insert their own imported bets" ON imported_bets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own imported bets" ON imported_bets;
CREATE POLICY "Users can update their own imported bets" ON imported_bets
  FOR UPDATE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_imported_bets_updated_at ON imported_bets;
CREATE TRIGGER update_imported_bets_updated_at
  BEFORE UPDATE ON imported_bets
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
