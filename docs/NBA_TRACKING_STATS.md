# NBA Tracking Stats Integration

This guide explains how to fetch and display **potential assists**, **potential rebounds**, and other advanced tracking statistics from the NBA Stats API.

## Overview

The NBA provides official tracking stats through their `stats.nba.com` API, including:

- **Potential Assists**: Passes that would have been assists if the shot was made
- **Assist Points Created**: Total points generated from your assists
- **Rebound Chances**: Number of rebounding opportunities
- **Contested vs Uncontested Rebounds**: Breakdown of rebound difficulty
- **Pass Success Rate**: Conversion rate of passes to assists
- And much more!

## What We've Built

### 1. API Route (`/api/tracking-stats`)

A server-side Next.js route that fetches data from NBA Stats API with:
- ✅ Proper headers to avoid getting blocked
- ✅ Rate limiting protection
- ✅ Error handling and retries
- ✅ Response caching (1 hour cache, 24h stale-while-revalidate)
- ✅ Multiple data endpoints (base stats, passing stats, rebounding stats)

### 2. TypeScript Types (`lib/types/trackingStats.ts`)

Fully typed interfaces for all tracking stats data.

### 3. React Hook (`hooks/useTrackingStats.ts`)

Easy-to-use hook for fetching tracking stats in your components:

```typescript
const { data, loading, error } = useTrackingStats({
  playerId: "203507", // Giannis Antetokounmpo
  season: 2024,
  perMode: "PerGame"
});
```

### 4. UI Component (`components/TrackingStatsCard.tsx`)

Pre-built component that displays all tracking stats beautifully.

## Usage Examples

### Example 1: Basic Usage

```tsx
import { TrackingStatsCard } from '@/components/TrackingStatsCard';

export default function PlayerPage() {
  return (
    <div>
      <TrackingStatsCard 
        playerId="2544" 
        playerName="LeBron James"
      />
    </div>
  );
}
```

### Example 2: Custom Hook Usage

```tsx
import { useTrackingStats } from '@/hooks/useTrackingStats';

export default function CustomComponent() {
  const { data, loading, error } = useTrackingStats({
    playerId: "203507",
    season: 2024,
    perMode: "PerGame",
    seasonType: "Regular Season"
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  const potentialAssists = data?.passing_stats?.POTENTIAL_AST;
  const reboundChances = data?.rebounding_stats?.REB_CHANCES;

  return (
    <div>
      <h2>Potential Assists: {potentialAssists}</h2>
      <h2>Rebound Chances: {reboundChances}</h2>
    </div>
  );
}
```

### Example 3: Direct API Call

```typescript
const response = await fetch('/api/tracking-stats?player_id=203507&season=2024&per_mode=PerGame');
const data = await response.json();

console.log('Potential Assists:', data.passing_stats?.POTENTIAL_AST);
console.log('Rebound Chances:', data.rebounding_stats?.REB_CHANCES);
```

## API Parameters

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `player_id` | string | ✅ Yes | - | NBA player ID |
| `season` | number | ❌ No | Current | Season year (e.g., 2024) |
| `per_mode` | string | ❌ No | "PerGame" | "PerGame", "Totals", or "Per36" |
| `season_type` | string | ❌ No | "Regular Season" | "Regular Season" or "Playoffs" |

### Response Structure

```typescript
{
  player_id: string;
  season: string; // "2024-25"
  per_mode: string;
  season_type: string;
  base_stats: {
    PLAYER_NAME: string;
    GP: number;
    MIN: number;
    PTS: number;
    // ... all standard stats
  };
  passing_stats: {
    POTENTIAL_AST: number;        // 🎯 KEY STAT
    AST_PTS_CREATED: number;      // 🎯 KEY STAT
    PASSES_MADE: number;
    AST_TO_PASS_PCT: number;
    SECONDARY_AST: number;
    // ...
  };
  rebounding_stats: {
    REB_CHANCES: number;          // 🎯 KEY STAT
    REB_CHANCE_PCT: number;       // 🎯 KEY STAT
    REB_CONTESTED: number;
    REB_UNCONTESTED: number;
    OREB_CHANCES: number;
    DREB_CHANCES: number;
    // ...
  };
}
```

## How to Avoid Getting Blocked

The NBA Stats API is publicly accessible but they monitor for abuse. Here's how we stay safe:

### ✅ Do's

1. **Use Proper Headers** (Already implemented)
   - User-Agent that mimics a real browser
   - Referer from nba.com
   - Standard security headers (sec-ch-ua, etc.)

2. **Implement Rate Limiting** (Already implemented)
   - Our API uses `checkRateLimit()` middleware
   - Prevents excessive requests from single IP

3. **Cache Responses** (Already implemented)
   - 1 hour cache on successful responses
   - 24 hour stale-while-revalidate
   - Reduces redundant API calls

4. **Add Delays Between Bulk Requests**
   ```typescript
   // If fetching multiple players
   for (const playerId of playerIds) {
     await fetch(`/api/tracking-stats?player_id=${playerId}`);
     await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
   }
   ```

5. **Handle Errors Gracefully**
   - Our implementation catches errors and returns user-friendly messages
   - Doesn't retry immediately on failure

### ❌ Don'ts

1. **Don't make rapid-fire requests**
   - Bad: 100 requests in 10 seconds
   - Good: Batch requests with delays

2. **Don't skip the cache**
   - Use our API route instead of calling NBA directly
   - The route has caching built-in

3. **Don't use your client's IP directly**
   - Always proxy through your API route
   - This protects your users' IPs

4. **Don't ignore rate limit responses**
   - If you get 429 (Too Many Requests), back off exponentially

## Best Practices

### 1. Prefetch Data

Load tracking stats when the user navigates to a player page, not when they click a button:

```tsx
// In your player page
useEffect(() => {
  // Prefetch tracking stats
  fetch(`/api/tracking-stats?player_id=${playerId}`);
}, [playerId]);
```

### 2. Show Loading States

Always show loading indicators:

```tsx
{loading && <Spinner />}
{data && <TrackingStatsCard data={data} />}
```

### 3. Handle Missing Data

Not all players have tracking stats (e.g., rookies with few games):

```tsx
if (!data?.passing_stats?.POTENTIAL_AST) {
  return <div>No tracking data available</div>;
}
```

### 4. Batch Requests

If you need stats for multiple players, add a delay:

```typescript
async function fetchMultiplePlayerStats(playerIds: string[]) {
  const results = [];
  
  for (const playerId of playerIds) {
    const response = await fetch(`/api/tracking-stats?player_id=${playerId}`);
    results.push(await response.json());
    
    // Wait 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}
```

## Integration with Your Dashboard

To add tracking stats to your existing NBA dashboard:

### Option 1: Add to Player Research Page

```tsx
// In app/nba/research/dashboard/page.tsx

import { TrackingStatsCard } from '@/components/TrackingStatsCard';

// Inside your component, add:
<TrackingStatsCard 
  playerId={selectedPlayer.id}
  playerName={selectedPlayer.name}
  season={selectedSeason}
/>
```

### Option 2: Create a Dedicated Tracking Stats Tab

```tsx
const [activeTab, setActiveTab] = useState('overview');

<div>
  <Tabs>
    <Tab onClick={() => setActiveTab('overview')}>Overview</Tab>
    <Tab onClick={() => setActiveTab('tracking')}>Tracking Stats</Tab>
  </Tabs>
  
  {activeTab === 'tracking' && (
    <TrackingStatsCard playerId={playerId} />
  )}
</div>
```

### Option 3: Add Specific Stats to Existing Cards

```tsx
const { data } = useTrackingStats({ playerId });

<div className="stat-grid">
  <StatCard 
    label="Potential Assists" 
    value={data?.passing_stats?.POTENTIAL_AST} 
  />
  <StatCard 
    label="Rebound Chances" 
    value={data?.rebounding_stats?.REB_CHANCES} 
  />
</div>
```

## Troubleshooting

### Issue: "429 Too Many Requests"

**Solution**: You're making requests too quickly. Add delays between requests or increase cache time.

### Issue: "No tracking data available"

**Solution**: 
- Player might not have enough games played
- Check if the season/player_id is correct
- Try different season_type (Regular Season vs Playoffs)

### Issue: "NBA API 500: ..."

**Solution**: NBA API is temporarily down. This is rare but happens. Implement a retry mechanism:

```typescript
async function fetchWithRetry(url: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1))); // Exponential backoff
    }
  }
}
```

## Key Stats Explained

### Potential Assists (POTENTIAL_AST)
Number of passes that would have been assists if the shot was made. Shows playmaking ability regardless of teammate efficiency.

**Example**: If a player has 8 assists but 12 potential assists, it means teammates missed 4 shots after good passes.

### Assist Points Created (AST_PTS_CREATED)
Total points scored by teammates from your assists. Shows offensive impact.

### Rebound Chances (REB_CHANCES)
Number of times the ball was available to be rebounded when the player was in position. Shows hustle and positioning.

### Rebound Chance % (REB_CHANCE_PCT)
Percentage of available rebounds the player actually secured. Shows rebounding efficiency.

## Further Resources

- [NBA Stats API Documentation](https://github.com/swar/nba_api)
- [NBA Player IDs](https://www.balldontlie.io/home.html#get-all-players)
- [Understanding NBA Tracking Stats](https://www.nba.com/stats/help/glossary)

## Support

If you encounter issues:
1. Check the console for detailed error messages
2. Verify the player_id is correct
3. Ensure your rate limit middleware is working
4. Check NBA API status (rarely down)

---

**Built with ❤️ for StatTrackr**


