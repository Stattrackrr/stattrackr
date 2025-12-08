# Testing Parlay Leg Indicators

## Quick Test Steps

### Option 1: Manual Testing (Recommended)

1. **Start your dev server:**
   ```bash
   npm run dev
   ```

2. **Create a test parlay bet today:**
   - Go to the Journal page
   - Click "Add Bet" or use the Add to Journal modal
   - Create a parlay with 2-3 legs (e.g., "Parlay: Player A over 20.5 Points + Player B over 10.5 Rebounds")
   - Save the bet

3. **Update the bet result:**
   - You can manually update the bet result in Supabase:
     ```sql
     -- Find your bet ID first
     SELECT id, selection, created_at, result 
     FROM bets 
     WHERE created_at::date = CURRENT_DATE 
     AND market LIKE 'parlay%'
     ORDER BY created_at DESC 
     LIMIT 5;
     
     -- Then update it (replace 'YOUR_BET_ID' with actual ID)
     UPDATE bets 
     SET result = 'win'  -- or 'loss' to test X marks
     WHERE id = 'YOUR_BET_ID';
     ```
   - Or use the check-journal-bets API to auto-resolve:
     ```bash
     curl http://localhost:3000/api/check-journal-bets
     ```

4. **Verify the indicators:**
   - Refresh the Journal page
   - Look for your parlay bet
   - You should see:
     - ✓ (green checkmark) for each leg if result = 'win'
     - ✗ (red X) for each leg if result = 'loss'
     - No indicators if result = 'pending' or 'void'

### Option 2: Quick SQL Test

Run this in Supabase SQL Editor to create a test bet and verify:

```sql
-- Create a test parlay bet for today
INSERT INTO bets (
  user_id, 
  date, 
  sport, 
  market, 
  selection, 
  stake, 
  currency, 
  odds, 
  result,
  created_at
)
SELECT 
  auth.uid(),
  CURRENT_DATE,
  'NBA',
  'Parlay 2',
  'Parlay: Nikola Jokic over 25.5 Points + LeBron James over 8.5 Assists',
  100,
  'USD',
  3.5,
  'win',  -- Change to 'loss' to test X marks
  NOW()
WHERE auth.uid() IS NOT NULL
RETURNING *;
```

Then refresh your Journal page to see the indicators.

## What to Check

✅ **Indicators only show for bets created TODAY**
✅ **Green ✓ appears for each leg when parlay = 'win'**
✅ **Red ✗ appears for each leg when parlay = 'loss'**
✅ **No indicators for 'pending' or 'void' bets**
✅ **Works in both mobile and desktop views**

## Debugging

Check the browser console for:
- `[Journal] Bet created today:` - confirms date check is working
- Verify `bet.created_at` is being read correctly
- Check that `bet.result` is 'win' or 'loss' (not 'pending')

## Notes

- The current implementation shows all legs as winning if the parlay won, and all legs as losing if the parlay lost
- This is because individual leg results aren't stored in the database
- To show individual leg results, we'd need to store leg outcomes when resolving parlays




