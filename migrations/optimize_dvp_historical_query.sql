-- ============================================
-- OPTIMIZE DVP HISTORICAL QUERY
-- Creates a function to efficiently get latest snapshot per team
-- This reduces egress from thousands of rows to just 30 rows (one per team)
-- ============================================

-- Create function to get latest DvP rank snapshot per team for a given date
CREATE OR REPLACE FUNCTION get_latest_dvp_snapshots(
  p_season INTEGER,
  p_position TEXT,
  p_metric TEXT,
  p_game_date DATE
)
RETURNS TABLE (
  team TEXT,
  rank INTEGER,
  snapshot_date DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (drs.team)
    drs.team,
    drs.rank,
    drs.snapshot_date
  FROM dvp_rank_snapshots drs
  WHERE drs.season = p_season
    AND drs.position = p_position
    AND drs.metric = p_metric
    AND drs.snapshot_date <= p_game_date
  ORDER BY drs.team, drs.snapshot_date DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Add comment
COMMENT ON FUNCTION get_latest_dvp_snapshots IS 'Efficiently returns latest DvP rank snapshot per team for a given date. Uses DISTINCT ON to minimize data transfer.';
