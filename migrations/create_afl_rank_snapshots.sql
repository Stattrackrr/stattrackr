-- Historical AFL rank snapshots for advanced filters (OA + DVP)
CREATE TABLE IF NOT EXISTS afl_rank_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  season INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('oa', 'dvp')),
  position TEXT NOT NULL, -- 'ALL' for OA, DEF/MID/FWD/RUC for DVP
  metric TEXT NOT NULL, -- OA stat code (e.g. D/UP/CP/HB/K/FF) or DVP metric key
  team TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 1 AND rank <= 18),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_date, season, source, position, metric, team)
);

CREATE INDEX IF NOT EXISTS idx_afl_rank_snapshots_lookup
  ON afl_rank_snapshots(season, source, position, metric, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_afl_rank_snapshots_team
  ON afl_rank_snapshots(team);

COMMENT ON TABLE afl_rank_snapshots IS 'Weekly AFL OA/DVP rank snapshots used for historical advanced filters.';
