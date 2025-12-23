-- Create table for storing historical DvP rank snapshots
-- This allows us to show the accurate DvP rank for each game at the time it was played
CREATE TABLE IF NOT EXISTS dvp_rank_snapshots (
  id BIGSERIAL PRIMARY KEY,
  
  -- Snapshot identification
  snapshot_date DATE NOT NULL, -- Date when this snapshot was taken
  season INTEGER NOT NULL, -- NBA season year (e.g., 2025)
  
  -- Position and metric
  position TEXT NOT NULL CHECK (position IN ('PG', 'SG', 'SF', 'PF', 'C')),
  metric TEXT NOT NULL, -- e.g., 'pts', 'reb', 'ast', 'pra', etc.
  
  -- Team and rank
  team TEXT NOT NULL, -- Team abbreviation (normalized)
  rank INTEGER NOT NULL CHECK (rank >= 0 AND rank <= 30), -- 1-30 for valid ranks, 0 for null/missing
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure we don't store duplicate snapshots
  UNIQUE(snapshot_date, season, position, metric, team)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_dvp_snapshots_date_season ON dvp_rank_snapshots(snapshot_date DESC, season);
CREATE INDEX IF NOT EXISTS idx_dvp_snapshots_position_metric ON dvp_rank_snapshots(position, metric);
CREATE INDEX IF NOT EXISTS idx_dvp_snapshots_team ON dvp_rank_snapshots(team);
CREATE INDEX IF NOT EXISTS idx_dvp_snapshots_lookup ON dvp_rank_snapshots(season, position, metric, team, snapshot_date DESC);

-- Composite index for the most common query: get rank for a team/position/metric on a specific date
CREATE INDEX IF NOT EXISTS idx_dvp_snapshots_query ON dvp_rank_snapshots(season, position, metric, team, snapshot_date DESC);

COMMENT ON TABLE dvp_rank_snapshots IS 'Historical DvP rank snapshots - stores rankings per position/metric/team for each date';
COMMENT ON COLUMN dvp_rank_snapshots.snapshot_date IS 'Date when this snapshot was taken (use game date to look up historical rank)';
COMMENT ON COLUMN dvp_rank_snapshots.rank IS 'DvP rank (1-30, where 1 is best defense, 30 is worst. 0 means no data)';

