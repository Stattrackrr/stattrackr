# How to Reset Prematurely Resolved Bets

This guide explains how to fix bets that were incorrectly resolved before games actually finished.

## The Problem

Bets were being resolved based on estimated completion time (2.5 hours after tipoff) instead of waiting for games to be marked as "final". This caused bets to resolve while games were still in progress.

## The Fix

The code has been updated to **only** resolve bets when the game status explicitly includes "final". However, bets that were already incorrectly resolved need to be reset and re-checked.

## Option 1: Using the API Endpoint (Recommended)

### Step 1: Reset the Bets

Call the reset endpoint with the date(s) of the affected bets:

```bash
# For a single date (e.g., Dec 9, 2025)
GET /api/reset-bets?date=2025-12-09

# For a date range
GET /api/reset-bets?date=2025-12-09&endDate=2025-12-10

# Filter by specific player
GET /api/reset-bets?date=2025-12-09&playerName=Norman Powell
```

**Example using curl:**
```bash
curl "http://localhost:3000/api/reset-bets?date=2025-12-09" \
  -H "Cookie: your-session-cookie"
```

**Example in browser console:**
```javascript
fetch('/api/reset-bets?date=2025-12-09')
  .then(r => r.json())
  .then(console.log);
```

### Step 2: Re-check the Bets

After resetting, call the check endpoint with `recalculate=true`:

```bash
GET /api/check-journal-bets?recalculate=true
```

**Example using curl:**
```bash
curl "http://localhost:3000/api/check-journal-bets?recalculate=true" \
  -H "Cookie: your-session-cookie"
```

The `recalculate=true` parameter tells the endpoint to re-check bets that are already resolved (win/loss), not just pending ones.

## Option 2: Using the Node.js Script

### Step 1: Reset the Bets

Run the script from the project root:

```bash
# For a single date
node scripts/reset-prematurely-resolved-bets.js 2025-12-09

# For a date range
node scripts/reset-prematurely-resolved-bets.js 2025-12-09 2025-12-10
```

The script will:
- Find all NBA bets that were resolved (win/loss) on the specified date(s)
- Reset them back to `pending` status
- Clear their `actual_value`

### Step 2: Re-check the Bets

After resetting, trigger the check endpoint with recalculate mode:

```bash
# Using curl
curl "http://localhost:3000/api/check-journal-bets?recalculate=true"

# Or use the trigger script if you have one
node scripts/trigger-check-journal-bets.js
```

## What Happens Next

1. **Bets are reset** to `pending` status
2. **The check endpoint runs** with the fixed logic
3. **Bets are only resolved** when games are actually marked as "final"
4. **Correct results** are calculated based on final game stats

## Verification

After running the reset and re-check:

1. Check your journal to see if bets are now showing correct results
2. Verify that games that are still in progress have bets marked as `pending` or `live`
3. Confirm that final games have bets correctly marked as `win` or `loss` with accurate `actual_value`

## Notes

- The reset endpoint only affects **your own bets** (authenticated user)
- The script uses the service role key, so it can reset any user's bets (use with caution)
- Make sure games are actually finished before re-checking, or bets will remain pending until games are final

