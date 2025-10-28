# StatTrackr Utilities Library

This directory contains shared utilities, constants, and helper functions used throughout the StatTrackr application.

## Table of Contents

- [Core Utilities](#core-utilities)
- [NBA Specific](#nba-specific)
- [Type Definitions](#type-definitions)
- [Usage Examples](#usage-examples)

---

## Core Utilities

### `cache.ts` - Server-Side Caching

In-memory caching system with TTL (Time To Live) for API responses.

**Features:**
- Automatic expiration based on configurable TTLs
- Auto-cleanup of stale entries
- Cache statistics and monitoring
- Documented TTL rationale for each data type

**Usage:**
```typescript
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';

// Set cache
const key = getCacheKey.playerStats('123', 2024);
cache.set(key, data, CACHE_TTL.PLAYER_STATS);

// Get cache
const cached = cache.get(key);

// Check stats
const stats = cache.getStats();
```

**TTL Values:**
- Player Stats: 8 hours (game stats finalized after games)
- Games: 5 hours (moderate freshness for schedules)
- Odds: 17 minutes (frequent updates, prime number prevents thundering herd)
- Advanced Stats: 1 hour (expensive to compute)
- Injuries: 30 minutes (fast-changing on game days)

---

### `rateLimit.ts` - API Rate Limiting

Protects API routes from abuse and conserves external API quotas.

**Features:**
- IP-based request tracking
- Configurable limits per time window
- Automatic cleanup of expired entries
- Proper HTTP 429 responses with retry headers
- Statistics and monitoring

**Usage:**
```typescript
import { checkRateLimit } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }
  
  // ... your API logic
}
```

**Default Limits:**
- Standard: 100 requests per 15 minutes
- Strict: 10 requests per minute

**Response Headers:**
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: When limit resets (ISO 8601)
- `Retry-After`: Seconds until retry allowed

---

### `requestDeduplication.ts` - Request Deduplication

Prevents redundant API calls by deduplicating identical requests in flight.

**Features:**
- Automatic deduplication within 30-second window
- Reduces API quota usage by 50-80%
- Helper functions for generating consistent cache keys
- Automatic cleanup of completed requests

**Usage:**
```typescript
import { requestDeduplicator, getPlayerStatsKey } from '@/lib/requestDeduplication';

const key = getPlayerStatsKey(playerId, season);
const data = await requestDeduplicator.dedupe(key, async () => {
  return await fetchFromAPI();
});
```

**Key Generators:**
- `getPlayerStatsKey(playerId, season, postseason)` - Player stats
- `getGamesKey(startDate, endDate, teamId?)` - Games
- `getAdvancedStatsKey(playerIds, season?, postseason)` - Advanced stats
- `getDvpKey(team, metric, games, season)` - DVP data

---

### `env.ts` - Environment Variable Validation

Type-safe environment variable access with validation.

**Features:**
- Validates required env vars on server startup
- Provides helpful error messages
- Type-safe access functions
- Never exposes actual values in logs

**Usage:**
```typescript
import { getEnv, getOptionalEnv, hasEnv } from '@/lib/env';

// Required variables (throws if missing)
const apiKey = getEnv('BALLDONTLIE_API_KEY');

// Optional variables
const oddsKey = getOptionalEnv('ODDS_API_KEY');

// Check if configured
if (hasEnv('ODDS_API_KEY')) {
  // Use odds API
}
```

**Required Variables:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `BALLDONTLIE_API_KEY` - Ball Don't Lie API key

**Optional Variables:**
- `ODDS_API_KEY` - The Odds API key
- `NEXT_PUBLIC_BASE_URL` - Base URL for API calls

---

## NBA Specific

### `nbaConstants.ts` - NBA Constants

Single source of truth for NBA team mappings and utilities.

**Features:**
- Team ID ↔ Abbreviation mappings
- Team full names
- Current season calculation
- Lookup utilities

**Usage:**
```typescript
import { 
  TEAM_ID_TO_ABBR, 
  ABBR_TO_TEAM_ID,
  currentNbaSeason,
  getTeamFullName 
} from '@/lib/nbaConstants';

// Get current season
const season = currentNbaSeason(); // e.g., 2024

// Get team info
const abbr = TEAM_ID_TO_ABBR[1]; // 'ATL'
const fullName = getTeamFullName('ATL'); // 'Atlanta Hawks'
```

**Season Logic:**
- Season starts October 15th
- Season year = year it starts (2024-25 season = 2024)
- Handles edge cases around October correctly

---

### `nbaAbbr.ts` - Team Abbreviation Normalization

Normalizes team abbreviations from various sources.

**Features:**
- Handles common aliases (NO → NOP, UTH → UTA)
- Historical team codes (NJ → BKN, SEA → OKC)
- Whitespace and punctuation handling
- ESPN logo URL generation with fallbacks

**Usage:**
```typescript
import { normalizeAbbr, getEspnLogoUrl } from '@/lib/nbaAbbr';

const normalized = normalizeAbbr('NO'); // 'NOP'
const logo = getEspnLogoUrl('NOP'); // ESPN CDN URL
```

---

### `nbaPlayers.ts` - Player Data

Sample player data and utilities.

**Features:**
- Sample players with correct Ball Don't Lie IDs
- Player interface definition
- Height formatting utilities

---

### `nbaUtils.ts` - NBA Utilities

General NBA-related helper functions.

---

## Type Definitions

### `types/apiResponses.ts` - API Response Types

TypeScript interfaces for external API responses.

**Interfaces:**
- `BdlTeam` - Ball Don't Lie team
- `BdlPlayer` - Ball Don't Lie player
- `BdlGame` - Ball Don't Lie game
- `BdlPlayerStats` - Ball Don't Lie player stats
- `BdlAdvancedStats` - Ball Don't Lie advanced stats
- `BdlPaginatedResponse<T>` - Paginated response wrapper
- `ApiErrorResponse` - Generic error response
- `ApiSuccessResponse<T>` - Generic success response

**Usage:**
```typescript
import { BdlPlayerStats, BdlPaginatedResponse } from '@/lib/types/apiResponses';

async function fetchStats(): Promise<BdlPlayerStats[]> {
  const response = await fetch(url);
  const json = await response.json() as BdlPaginatedResponse<BdlPlayerStats>;
  return json.data;
}
```

---

### `types/nba.ts` - NBA Type Definitions

Application-specific NBA types.

---

## Usage Examples

### Complete API Route with All Features

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { requestDeduplicator, getPlayerStatsKey } from '@/lib/requestDeduplication';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';
import { BdlPlayerStats, BdlPaginatedResponse } from '@/lib/types/apiResponses';
import { getEnv } from '@/lib/env';

export async function GET(req: NextRequest) {
  // 1. Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }

  const { searchParams } = new URL(req.url);
  const playerId = searchParams.get('player_id');
  const season = Number(searchParams.get('season')) || 2024;

  // 2. Check cache
  const cacheKey = getCacheKey.playerStats(playerId!, season);
  const cached = cache.get<BdlPlayerStats[]>(cacheKey);
  if (cached) {
    return NextResponse.json({ data: cached, cached: true });
  }

  // 3. Deduplicate request
  const dedupeKey = getPlayerStatsKey(playerId!, season);
  const data = await requestDeduplicator.dedupe(dedupeKey, async () => {
    // 4. Fetch from external API
    const apiKey = getEnv('BALLDONTLIE_API_KEY');
    const response = await fetch(
      `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    
    const json = await response.json() as BdlPaginatedResponse<BdlPlayerStats>;
    return json.data;
  });

  // 5. Cache result
  cache.set(cacheKey, data, CACHE_TTL.PLAYER_STATS);

  // 6. Return response
  return NextResponse.json({ data, cached: false });
}
```

---

## Best Practices

### Caching
1. Always use `getCacheKey` helpers for consistent keys
2. Choose appropriate TTL based on data freshness needs
3. Monitor cache hit rates via `cache.getStats()`
4. Consider request deduplication before caching

### Rate Limiting
1. Apply to all external API routes
2. Use strict limits for expensive operations
3. Add rate limit headers to responses for debugging
4. Monitor rate limit hits to adjust limits

### Type Safety
1. Use proper interfaces instead of `any`
2. Validate env vars with `getEnv()` functions
3. Type API responses explicitly
4. Avoid non-null assertions (`!`)

### Performance
1. Use request deduplication for frequently called endpoints
2. Set appropriate cache TTLs based on data volatility
3. Monitor cache and deduplication stats
4. Consider query result caching at database level

---

## Monitoring

### Cache Stats
```typescript
const stats = cache.getStats();
console.log(`Cache entries: ${stats.totalEntries}`);
console.log(`Valid entries: ${stats.validEntries}`);
console.log(`Hit rate: ${hitRate}%`);
```

### Rate Limit Stats
```typescript
const stats = apiRateLimiter.getStats();
console.log(`Tracked IPs: ${stats.totalTracked}`);
console.log(`Active windows: ${stats.activeWindows}`);
```

### Deduplication Stats
```typescript
const stats = requestDeduplicator.getStats();
console.log(`Pending requests: ${stats.pendingRequests}`);
console.log(`Keys: ${stats.keys.join(', ')}`);
```

---

## Testing

### Unit Tests (Recommended)
```typescript
import { currentNbaSeason } from '@/lib/nbaConstants';

describe('currentNbaSeason', () => {
  it('returns current year for Oct 15+', () => {
    // Mock date to Oct 15, 2024
    jest.useFakeTimers().setSystemTime(new Date('2024-10-15'));
    expect(currentNbaSeason()).toBe(2024);
  });
  
  it('returns previous year for Oct 1-14', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-10-10'));
    expect(currentNbaSeason()).toBe(2023);
  });
});
```

---

## Troubleshooting

### "Missing required environment variable"
- Check `.env.local` file exists
- Verify all required vars are set (see `lib/env.ts`)
- Restart dev server after changing env vars

### "Rate limit exceeded"
- Check `X-RateLimit-Reset` header for retry time
- Consider increasing limits if legitimate traffic
- Review rate limiter configuration

### Cache not hitting
- Verify cache keys are consistent
- Check TTL hasn't expired
- Monitor cache stats for hit/miss ratio
- Ensure cache cleanup isn't running too frequently

### Type errors after update
- Run `npm run build` to see all errors
- Update imports to use new type definitions
- Remove `any` types and add proper interfaces
- Check CHANGELOG.md for breaking changes

---

For more information, see:
- [CHANGELOG.md](../CHANGELOG.md) - Recent changes and migration guide
- [WARP.md](../WARP.md) - Development guide
- [.env.example](../.env.example) - Environment variable reference
