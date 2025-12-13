# Testing Bulk Stats Pre-fetching

## Quick Test Steps

### 1. Clear Cache and Start Fresh
```bash
# In your browser console, clear the cache
localStorage.clear();
sessionStorage.clear();

# Or visit with refresh flag
http://localhost:3000/nba?refresh=1
```

### 2. Open Browser DevTools
- **Console Tab**: Watch for pre-fetch logs
- **Network Tab**: Monitor API calls to `/api/stats`

### 3. What to Look For

#### ✅ Success Indicators (Console Logs)

You should see these logs in order:

1. **Pre-fetch Start**:
   ```
   [NBA Landing] 🚀 Pre-fetching stats for X unique players (Y props total)...
   ```

2. **Batch Progress**:
   ```
   [NBA Landing] 🚀 Pre-fetching batch 1/20 (5 players, 0/100 total)...
   [NBA Landing] 🚀 Pre-fetching batch 2/20 (5 players, 5/100 total)...
   ...
   ```

3. **Pre-fetch Complete**:
   ```
   [NBA Landing] ✅ Pre-fetch complete: 100/100 players (stats cached, ready for prop processing)
   ```

4. **Prop Processing** (should be FAST now):
   ```
   [NBA Landing] Processing props count (unique players): X
   [calculatePlayerAverages] Got X stats (cached) for PlayerName...
   ```

#### ✅ Network Tab Indicators

**Before Optimization:**
- Many `/api/stats` calls during prop processing
- Calls happen randomly as props are processed
- High chance of 429 errors

**After Optimization:**
- All `/api/stats` calls happen upfront (during pre-fetch phase)
- Calls are batched (5 players at a time)
- Fewer 429 errors (controlled rate)
- Prop processing phase has **ZERO** new `/api/stats` calls (uses cache)

### 4. Performance Metrics to Check

#### Timing Comparison

**Before:**
- Total time: 60-120+ seconds
- Many timeouts
- Props appear slowly one by one

**After:**
- Pre-fetch phase: ~30-60 seconds (controlled, batched)
- Prop processing: ~5-10 seconds (instant, uses cache)
- All props appear quickly after pre-fetch completes

### 5. Verify Cache is Working

In the console, you should see:
```
[calculatePlayerAverages] Got X stats (cached) for PlayerName...
```

NOT:
```
[calculatePlayerAverages] Fetching reg: /api/stats?player_id=...
```

If you see "Fetching" logs during prop processing, the cache isn't working.

### 6. Test Scenarios

#### Scenario A: Fresh Load (No Cache)
1. Visit `http://localhost:3000/nba?refresh=1`
2. Watch console for pre-fetch logs
3. Verify all stats are fetched upfront
4. Verify prop processing is fast (uses cache)

#### Scenario B: Cached Load
1. Visit `http://localhost:3000/nba` (no refresh)
2. Should use cached player props (no pre-fetch needed)
3. Console should show: `[NBA Landing] ✅ Using fresh cached player props data`

#### Scenario C: Rate Limiting Test
1. Watch Network tab during pre-fetch
2. Should see controlled batching (5 players at a time)
3. Should see 300ms delays between batches
4. Should handle 429 errors gracefully (retries with backoff)

### 7. Debugging

If pre-fetch isn't working:

1. **Check console for errors**:
   - Look for `[calculatePlayerAverages] Error fetching stats`
   - Check if `getPlayerIdFromName` is working

2. **Verify player ID mapping**:
   ```javascript
   // In browser console
   console.log('Testing player ID lookup:', getPlayerIdFromName('LeBron James'));
   ```

3. **Check cache population**:
   ```javascript
   // The cache is in-memory, but you can verify by checking logs
   // Look for: "Got X stats (fresh)" during pre-fetch
   // Then: "Got X stats (cached)" during prop processing
   ```

### 8. Expected Console Output

```
[NBA Landing] ⚠️ Cache miss - processing player props...
[NBA Landing] 🚀 Pre-fetching stats for 150 unique players (500 props total)...
[NBA Landing] 🚀 Pre-fetching batch 1/30 (5 players, 0/150 total)...
[calculatePlayerAverages] Got 82 stats (fresh) for Player1 (12345), season 2025, reg
[calculatePlayerAverages] Got 82 stats (fresh) for Player1 (12345), season 2025, po
...
[NBA Landing] 🚀 Pre-fetching batch 2/30 (5 players, 5/150 total)...
...
[NBA Landing] ✅ Pre-fetch complete: 150/150 players (stats cached, ready for prop processing)
[NBA Landing] Processing props count (unique players): 500
[calculatePlayerAverages] Got 82 stats (cached) for Player1 (12345), season 2025, reg
[calculatePlayerAverages] Got 82 stats (cached) for Player1 (12345), season 2025, po
...
```

### 9. Success Criteria

✅ **Pre-fetch works if:**
- All `/api/stats` calls happen during pre-fetch phase
- Prop processing shows "cached" in logs (not "fresh")
- No timeouts during prop processing
- Props appear quickly after pre-fetch completes
- Total time is reduced compared to before

❌ **Pre-fetch NOT working if:**
- You see "Fetching" logs during prop processing
- Many 429 errors during prop processing
- Props still take a long time to appear
- Timeouts still occur

