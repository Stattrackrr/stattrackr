# How to Add OREB and DREB Columns

The sync is failing because the `oreb` and `dreb` columns don't exist in the database yet.

## Quick Fix

1. **Go to your Supabase Dashboard**
   - Navigate to: https://supabase.com/dashboard
   - Select your project
   - Go to **SQL Editor**

2. **Run this migration:**

```sql
-- Add offensive and defensive rebound columns to player_season_averages table
ALTER TABLE player_season_averages 
  ADD COLUMN IF NOT EXISTS oreb DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dreb DECIMAL(5,2) DEFAULT 0;

-- Update comment
COMMENT ON COLUMN player_season_averages.oreb IS 'Offensive rebounds per game average';
COMMENT ON COLUMN player_season_averages.dreb IS 'Defensive rebounds per game average';
```

3. **Click "Run"** to execute the migration

4. **Verify the columns were added:**

```sql
-- Check if columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'player_season_averages' 
  AND column_name IN ('oreb', 'dreb');
```

You should see both `oreb` and `dreb` columns listed.

5. **Re-run the sync:**

```powershell
$body = '{"season": 2025}'; Invoke-WebRequest -Uri "https://stattrackr.co/api/player-season-averages/sync" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
```

## Alternative: Copy from Migration File

The migration is also saved in:
- `migrations/add_oreb_dreb_to_player_season_averages.sql`

You can copy the contents of that file and paste it into the Supabase SQL Editor.

