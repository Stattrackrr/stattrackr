# Update Parlay Leg Results

## Problem
The parlay leg indicators were showing all legs as lost when the parlay lost, because individual leg results weren't stored in the database.

## Solution
1. ✅ Updated API to store individual leg results in `parlay_legs` JSONB column
2. ✅ Updated frontend to read and display individual leg results

## How to Update Existing Bets

For existing resolved parlays, you need to recalculate them to populate individual leg results:

### Option 1: Recalculate via API (Recommended)
```bash
curl "http://localhost:3000/api/check-journal-bets?recalculate=true"
```

This will:
- Re-evaluate all resolved parlay bets
- Calculate individual leg results
- Store them in the `parlay_legs` column
- Update the display to show correct ✓/✗ for each leg

### Option 2: Recalculate Specific Bet (SQL)
If you know the bet ID:
```sql
-- First, set the bet back to pending temporarily
UPDATE bets 
SET result = 'pending' 
WHERE id = 'YOUR_BET_ID';

-- Then run the API check (it will resolve it again with leg results)
-- Or manually update parlay_legs if you have the data
```

## What Changed

**API (`app/api/check-journal-bets/route.ts`):**
- Now stores individual leg results (`won`, `void`) in `parlay_legs` when resolving parlays
- Works for both structured parlay_legs and legacy text-based parlays

**Frontend (`app/journal/page.tsx`):**
- Reads individual leg results from `parlay_legs[index].won`
- Shows ✓ for legs where `won = true`
- Shows ✗ for legs where `won = false`
- Falls back to parlay-level result if individual data not available

## Testing

1. Run the recalculate API call
2. Refresh your Journal page
3. You should now see:
   - ✓ for legs that actually hit
   - ✗ for legs that actually failed
   - No indicator for void legs




