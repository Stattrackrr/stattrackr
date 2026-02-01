-- Prediction Engine Manual Data Tables
-- These tables store data that can't be fetched from APIs

-- Coach Tendencies
-- Tracks how coaches manage minutes, rest, and rotations
CREATE TABLE IF NOT EXISTS coach_tendencies (
  coach_name TEXT PRIMARY KEY,
  team TEXT NOT NULL,
  rest_tendency DECIMAL DEFAULT 0.5, -- 0-1: % of time rests players on back-to-backs
  blowout_tendency DECIMAL DEFAULT 0.7, -- 0-1: % of time pulls starters in blowouts (>15 pts)
  minutes_restriction_tendency DECIMAL DEFAULT 0.3, -- 0-1: how often restricts minutes
  system TEXT, -- 'pace-and-space', 'defensive', 'iso-heavy', 'motion', etc.
  avg_starter_minutes DECIMAL, -- Average minutes for starters
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Arena Factors
-- Environmental factors that affect player performance
CREATE TABLE IF NOT EXISTS arena_factors (
  arena_name TEXT PRIMARY KEY,
  team TEXT NOT NULL,
  city TEXT,
  state TEXT,
  altitude INTEGER DEFAULT 0, -- feet above sea level (Denver = 5280)
  capacity INTEGER,
  shooting_factor DECIMAL DEFAULT 1.0, -- multiplier for shooting % (1.0 = neutral)
  home_court_advantage DECIMAL DEFAULT 1.0, -- multiplier for home performance
  timezone TEXT, -- 'America/New_York', 'America/Los_Angeles', etc.
  latitude DECIMAL,
  longitude DECIMAL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Player Contracts
-- Track contract years for motivation modeling
CREATE TABLE IF NOT EXISTS player_contracts (
  player_id INTEGER PRIMARY KEY,
  player_name TEXT NOT NULL,
  team TEXT,
  contract_year BOOLEAN DEFAULT FALSE, -- is this their contract year?
  years_remaining INTEGER,
  salary BIGINT, -- in dollars
  is_expiring BOOLEAN DEFAULT FALSE, -- contract expires this year
  updated_at TIMESTAMP DEFAULT NOW()
);

-- National TV Schedule
-- Games on national TV (players perform better)
CREATE TABLE IF NOT EXISTS national_tv_games (
  game_id TEXT PRIMARY KEY,
  game_date DATE NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  network TEXT, -- 'ESPN', 'TNT', 'ABC', 'NBA TV', etc.
  is_national BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Referee Stats
-- Track referee tendencies (fouls, pace, bias)
CREATE TABLE IF NOT EXISTS referee_stats (
  referee_name TEXT PRIMARY KEY,
  fouls_per_game DECIMAL, -- average fouls called per game
  pace DECIMAL, -- average pace of games they officiate
  home_bias DECIMAL DEFAULT 0, -- positive = favors home, negative = favors away
  total_games INTEGER DEFAULT 0,
  avg_free_throws DECIMAL, -- average FTs per game
  technical_fouls_rate DECIMAL, -- techs per game
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Model Performance Tracking
-- Track accuracy of each model for dynamic weight adjustment
CREATE TABLE IF NOT EXISTS model_performance (
  model_name TEXT NOT NULL,
  date DATE NOT NULL,
  predictions INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  accuracy DECIMAL, -- correct / predictions
  avg_error DECIMAL, -- average prediction error
  total_bets INTEGER DEFAULT 0,
  winning_bets INTEGER DEFAULT 0,
  roi DECIMAL, -- return on investment
  PRIMARY KEY (model_name, date)
);

-- Player Former Teams
-- Track revenge games
CREATE TABLE IF NOT EXISTS player_former_teams (
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  former_team TEXT NOT NULL,
  years_played INTEGER,
  last_season TEXT, -- '2023-24'
  PRIMARY KEY (player_id, former_team)
);

-- Prediction Cache
-- Store predictions to avoid recalculating
CREATE TABLE IF NOT EXISTS prediction_cache (
  cache_key TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  stat_type TEXT NOT NULL, -- 'pts', 'reb', 'ast', etc.
  game_date DATE NOT NULL,
  opponent TEXT NOT NULL,
  prediction DECIMAL NOT NULL,
  confidence DECIMAL, -- 0-1
  line DECIMAL, -- bookmaker line
  edge DECIMAL, -- prediction - line
  recommendation TEXT, -- 'STRONG BET', 'MODERATE BET', 'PASS'
  model_breakdown JSONB, -- individual model predictions
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP -- when to invalidate cache
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_coach_tendencies_team ON coach_tendencies(team);
CREATE INDEX IF NOT EXISTS idx_arena_factors_team ON arena_factors(team);
CREATE INDEX IF NOT EXISTS idx_player_contracts_team ON player_contracts(team);
CREATE INDEX IF NOT EXISTS idx_player_contracts_contract_year ON player_contracts(contract_year) WHERE contract_year = TRUE;
CREATE INDEX IF NOT EXISTS idx_national_tv_games_date ON national_tv_games(game_date);
CREATE INDEX IF NOT EXISTS idx_model_performance_date ON model_performance(date);
CREATE INDEX IF NOT EXISTS idx_player_former_teams_player ON player_former_teams(player_id);
CREATE INDEX IF NOT EXISTS idx_prediction_cache_player_date ON prediction_cache(player_id, game_date);
CREATE INDEX IF NOT EXISTS idx_prediction_cache_expires ON prediction_cache(expires_at);

-- Insert sample data for testing

-- Coaches (sample data - will need to populate all 30 teams)
INSERT INTO coach_tendencies (coach_name, team, rest_tendency, blowout_tendency, system) VALUES
('Doc Rivers', 'MIL', 0.15, 0.70, 'pace-and-space'),
('Joe Mazzulla', 'BOS', 0.10, 0.65, 'pace-and-space'),
('Erik Spoelstra', 'MIA', 0.20, 0.75, 'defensive'),
('Steve Kerr', 'GSW', 0.25, 0.80, 'motion'),
('Tyronn Lue', 'LAC', 0.12, 0.68, 'iso-heavy')
ON CONFLICT (coach_name) DO NOTHING;

-- Arenas (sample data - will need to populate all 30 teams)
INSERT INTO arena_factors (arena_name, team, city, state, altitude, capacity, timezone, latitude, longitude) VALUES
('Ball Arena', 'DEN', 'Denver', 'CO', 5280, 19520, 'America/Denver', 39.7487, -105.0077),
('TD Garden', 'BOS', 'Boston', 'MA', 20, 19156, 'America/New_York', 42.3662, -71.0621),
('Crypto.com Arena', 'LAL', 'Los Angeles', 'CA', 300, 19068, 'America/Los_Angeles', 34.0430, -118.2673),
('Madison Square Garden', 'NYK', 'New York', 'NY', 33, 19812, 'America/New_York', 40.7505, -73.9934),
('Chase Center', 'GSW', 'San Francisco', 'CA', 0, 18064, 'America/Los_Angeles', 37.7680, -122.3877)
ON CONFLICT (arena_name) DO NOTHING;

-- Referees (sample data)
INSERT INTO referee_stats (referee_name, fouls_per_game, pace, home_bias, total_games) VALUES
('Tony Brothers', 42.5, 101.2, 0.05, 1200),
('Scott Foster', 44.2, 99.8, 0.08, 1500),
('Marc Davis', 38.6, 102.5, 0.02, 1100),
('Zach Zarba', 40.1, 100.9, 0.03, 1000),
('Ed Malloy', 41.8, 101.5, 0.06, 1300)
ON CONFLICT (referee_name) DO NOTHING;

COMMENT ON TABLE coach_tendencies IS 'Tracks coaching patterns for minute management and rotation decisions';
COMMENT ON TABLE arena_factors IS 'Environmental factors that affect player performance (altitude, home court, etc.)';
COMMENT ON TABLE player_contracts IS 'Contract status for motivation modeling (contract years, expiring deals)';
COMMENT ON TABLE national_tv_games IS 'Games on national TV where players tend to perform better';
COMMENT ON TABLE referee_stats IS 'Referee tendencies (fouls called, pace, home/away bias)';
COMMENT ON TABLE model_performance IS 'Tracks accuracy of each prediction model for dynamic weight adjustment';
COMMENT ON TABLE player_former_teams IS 'Tracks player history for revenge game modeling';
COMMENT ON TABLE prediction_cache IS 'Caches predictions to avoid recalculating expensive models';
