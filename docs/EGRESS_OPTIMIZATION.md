# Egress Optimization Guide

## Current Issue
**Egress: 5.722 GB / 5 GB (114% - EXCEEDED)**
**Database Size: 0.146 GB / 0.5 GB (29% - OK)**

The problem is **data transfer out** (egress), not storage. This happens when:
- Large API responses are sent to clients
- Queries return too much data
- No pagination/limits on queries
- Frequent polling/refreshing

## Main Culprits

### 1. Journal Page - Fetching ALL Bets
**File:** `app/journal/page.tsx:831-835`

```typescript
// ❌ CURRENT: Fetches ALL bets for user (no limit)
const { data, error } = await supabase
  .from('bets')
  .select('*')
  .eq('user_id', session.user.id)
  .order('date', { ascending: false });
```

**Problem:** If a user has hundreds/thousands of bets, this fetches ALL of them at once.

**Solution:** Add pagination or limit:
```typescript
// ✅ BETTER: Limit to recent bets
const { data, error } = await supabase
  .from('bets')
  .select('*')
  .eq('user_id', session.user.id)
  .order('date', { ascending: false })
  .limit(100); // Only fetch last 100 bets
```

### 2. Check Journal Bets - Fetching ALL Bets for ALL Users
**File:** `app/api/check-journal-bets/route.ts:1145-1170`

**Problem:** The `fetchBetsInBatches` function fetches ALL bets in batches of 100, but still loads everything into memory. For cron jobs processing all users, this could be thousands of bets.

**Current:** Already uses batching (good), but still processes all bets.

**Solution:** The skip logic for resolved bets should help, but we should also add a limit for cron jobs.

### 3. Check Journal Bets - No Limit on Batch Size
**File:** `app/api/check-journal-bets/route.ts:1145`

**Problem:** While it batches, it doesn't stop after a certain number of bets. If there are 10,000 pending bets, it will fetch all of them.

**Solution:** Add a max limit for safety:
```typescript
const fetchBetsInBatches = async (baseQuery: any, batchSize = 100, maxBets = 1000): Promise<any[]> => {
  // ... existing code ...
  while (hasMore && allBets.length < maxBets) {
    // ... fetch batch ...
  }
  return allBets;
};
```

## Recommendations

### Immediate Fixes (High Impact)

1. **Add limit to journal page bet fetching**
   - Only fetch last 100-200 bets initially
   - Load more on scroll/pagination

2. **Add max limit to check-journal-bets**
   - Process max 1000 bets per run
   - Skip already resolved bets (already implemented)

3. **Optimize query selects**
   - Only select needed columns, not `*`
   - Example: `.select('id,date,result,status,stake,odds')` instead of `.select('*')`

### Medium Priority

4. **Add pagination to journal page**
   - Load 50 bets at a time
   - Infinite scroll or "Load More" button

5. **Cache bet data client-side**
   - Don't refetch if data is fresh
   - Use React Query or SWR for caching

6. **Reduce check-journal-bets frequency**
   - If running every 10 minutes, consider 15-30 minutes
   - Only run when needed (not on every page load)

### Low Priority

7. **Compress API responses**
   - Use gzip compression (usually automatic)
   - Consider removing unnecessary fields from responses

8. **Monitor and log large queries**
   - Add logging for queries returning >100 rows
   - Alert on queries >1MB

## Quick Win: Add Limit to Journal Page

The biggest immediate win is limiting the journal page query:

```typescript
// In app/journal/page.tsx, line ~831
const { data, error } = await supabase
  .from('bets')
  .select('id,date,sport,market,selection,stake,currency,odds,result,status,bookmaker,created_at,opponent,actual_value,stat_type,player_id,game_date,line,over_under,parlay_legs') // Explicit columns
  .eq('user_id', session.user.id)
  .order('date', { ascending: false })
  .limit(200); // Only fetch last 200 bets
```

This alone could reduce egress by 50-80% if users have many bets.
