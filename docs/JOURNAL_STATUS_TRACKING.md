# Journal Bet Status Tracking

This document describes the implementation of automatic status tracking for journal bets, using the same game detection logic as the tracking component.

## Overview

Journal bets now automatically update their status from `pending` → `live` → `win/loss` based on real game data, matching the behavior of tracked props.

## Components

### 1. Database Schema Updates

**File**: `migrations/add_pending_result.sql`

Added `'pending'` to the allowed result values in the `bets` table:

```sql
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_result_check;
ALTER TABLE bets ADD CONSTRAINT bets_result_check 
  CHECK (result IN ('win', 'loss', 'void', 'pending'));
```

The `bets` table already has these columns (from `supabase_tracking_schema.sql`):
- `player_id`: TEXT - Ball Don't Lie player ID
- `player_name`: TEXT - Player's name
- `team`: TEXT - Player's team
- `opponent`: TEXT - Opposing team
- `stat_type`: TEXT - Type of stat (pts, reb, ast, etc.)
- `line`: DECIMAL - The prop line
- `over_under`: TEXT - 'over' or 'under'
- `game_date`: DATE - Date of the game
- `status`: TEXT - Game status (pending, live, completed)
- `actual_value`: DECIMAL - Actual stat value when completed

### 2. API Endpoint

**File**: `app/api/check-journal-bets/route.ts`

New API endpoint that:
- Fetches all pending NBA journal bets with player props
- Groups bets by game date to minimize API calls
- For each game:
  - Checks if game is live (started but < 3 hours elapsed)
  - Updates status to 'live' if game is in progress
  - When game is final:
    - Fetches player stats from Ball Don't Lie API
    - Calculates actual stat value (including combined stats like PRA)
    - Determines win/loss result based on line
    - Updates bet with result and actual value

**Game Status Detection Logic** (matches tracked bets):
```typescript
// Parse the game status timestamp
const tipoffTime = Date.parse(rawStatus);
if (!Number.isNaN(tipoffTime)) {
  const now = Date.now();
  const timeSinceTipoff = now - tipoffTime;
  const threeHoursMs = 3 * 60 * 60 * 1000;
  // Game is live if it started and hasn't been 3 hours yet
  isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
}
```

### 3. RightSidebar Updates

**File**: `components/RightSidebar.tsx`

Updated `fetchJournalBets` function to:
1. Call `/api/check-journal-bets` before fetching bets
2. Display proper game status badges:
   - **SCHEDULED**: Grey badge when `status === 'pending' && result === 'pending'`
   - **LIVE**: Yellow badge when `status === 'live' && result === 'pending'`
   - **W/L**: Green/Red badge when game is completed

### 4. AddToJournalModal Updates

**File**: `components/AddToJournalModal.tsx`

Changed initial bet status:
- `result: 'pending'` (was 'void')
- `status: 'pending'`

This ensures new bets show as "SCHEDULED" instead of "VOID".

### 5. Cron Job Configuration

**File**: `vercel.json`

Added automatic checking every 15 minutes:
```json
{
  "path": "/api/check-journal-bets",
  "schedule": "*/15 * * * *"
}
```

## User Flow

1. **Adding a Bet**:
   - User adds NBA prop bet from dashboard
   - Bet is saved with `result: 'pending'` and `status: 'pending'`
   - Shows as **SCHEDULED** in journal/sidebar

2. **Game Starts**:
   - Cron job runs every 15 minutes
   - Detects game has started (tipoff time < 3 hours ago)
   - Updates `status: 'live'`
   - Shows as **LIVE** in journal/sidebar

3. **Game Ends**:
   - Cron job detects game status contains "final"
   - Fetches player stats from API
   - Calculates win/loss based on actual value vs. line
   - Updates `result: 'win' or 'loss'`, `status: 'completed'`, `actual_value`
   - Shows **W** or **L** with profit/loss amount

4. **Manual Refresh**:
   - User can click refresh button in sidebar
   - Triggers immediate check of all pending bets
   - Updates display with latest status

## Benefits

- **Consistency**: Journal bets use identical logic to tracked props
- **Real-time Updates**: Automatic checking every 15 minutes
- **User Experience**: Clear status indicators (SCHEDULED → LIVE → W/L)
- **Accurate Results**: Uses official game data from Ball Don't Lie API
- **Performance**: Efficient batch processing by game date

## Technical Notes

- Both tracked props and journal bets share the same game detection logic
- The 3-hour window prevents false "live" status for completed games
- Combined stats (PRA, PR, RA) are properly calculated from individual stats
- Status updates are idempotent - safe to run multiple times
- Only NBA player props are tracked (non-NBA bets remain manual)
