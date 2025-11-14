-- Add bookmaker column to bets table
ALTER TABLE bets ADD COLUMN IF NOT EXISTS bookmaker TEXT;

-- Create index for faster queries by bookmaker
CREATE INDEX IF NOT EXISTS idx_bets_bookmaker ON bets(bookmaker);

