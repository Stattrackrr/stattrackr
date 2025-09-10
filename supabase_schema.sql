-- Create the bets table
CREATE TABLE bets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  sport TEXT NOT NULL,
  market TEXT,
  selection TEXT NOT NULL,
  stake DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('AUD', 'USD', 'GBP', 'EUR')),
  odds DECIMAL(10,3) NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'void')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create an index for faster queries
CREATE INDEX idx_bets_user_id ON bets(user_id);
CREATE INDEX idx_bets_date ON bets(date);
CREATE INDEX idx_bets_sport ON bets(sport);

-- Enable Row Level Security (RLS)
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;

-- Create policy to ensure users can only see their own bets
CREATE POLICY "Users can only see their own bets" ON bets
  FOR ALL USING (auth.uid() = user_id);

-- Create policy for insert
CREATE POLICY "Users can insert their own bets" ON bets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create policy for update
CREATE POLICY "Users can update their own bets" ON bets
  FOR UPDATE USING (auth.uid() = user_id);

-- Create policy for delete
CREATE POLICY "Users can delete their own bets" ON bets
  FOR DELETE USING (auth.uid() = user_id);

-- Function to automatically update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_bets_updated_at 
  BEFORE UPDATE ON bets 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
