# Bulk Caching Optimization Strategy

## Overview
Currently, we're making individual API calls per player for play types and shot charts, which is extremely slow and causes timeouts. The NBA Stats API returns ALL players in a single response, so we can fetch once and filter by player ID.

## Current Problems

### Play Type Analysis
- **Current**: 11 API calls per player (one per play type)
- **For 526 players**: 11 × 526 = **5,786 API calls**
- **Time**: ~8-15 seconds per call = **12-24 hours total**
- **Result**: 504 Gateway Timeout errors

### Shot Chart Enhanced
- **Current**: Individual API calls per player
- **For 526 players**: 526 API calls
- **Time**: Similar timeout issues

## Proposed Solution

### 1. Play Type Analysis - Bulk Fetch

**Strategy**: Fetch all 11 play types once (11 API calls total), store in bulk cache, then filter by player ID.

**Implementation**:
```typescript
// New endpoint: /api/cache/play-types-bulk
// Fetches all 11 play types for all players in one go
// Cache key: `player_playtypes_bulk_${season}`

// Structure:
{
  "PRBallHandler": {
    headers: [...],
    rows: [/* all players */]
  },
  "Transition": {
    headers: [...],
    rows: [/* all players */]
  },
  // ... 11 play types total
}
```

**Benefits**:
- **11 API calls** instead of 5,786
- **~2-3 minutes** instead of 12-24 hours
- No timeout issues
- Individual player requests filter from bulk cache (instant)

**Update `/api/play-type-analysis`**:
- Check bulk cache first (`player_playtypes_bulk_${season}`)
- If exists, filter rows by `PLAYER_ID`
- If missing, trigger background bulk fetch
- Fall back to individual API calls only if bulk cache unavailable

### 2. Shot Chart Enhanced - Bulk Fetch

**Strategy**: Similar approach - fetch all players' shot charts in bulk.

**Implementation**:
```typescript
// New endpoint: /api/cache/shot-charts-bulk
// Fetches shot chart data for all players
// Cache key: `player_shotcharts_bulk_${season}`

// Structure:
{
  "playerId1": {
    zones: [...],
    attempts: [...],
    // ... shot chart data
  },
  "playerId2": {
    // ...
  }
  // ... all players
}
```

**Benefits**:
- **1-2 API calls** instead of 526
- **~1-2 minutes** instead of hours
- No timeout issues

### 3. Team Opponent Rank (Already Optimized ✅)

**Current**: Already cached in bulk
- Cache key: `playtype_defensive_rankings_${season}`
- Structure: `{ playType: [{ team, ppp }, ...] }`
- **No changes needed**

### 4. Potentials (Already Optimized ✅)

**Current**: Already cached in bulk per team
- Cache key: `tracking_stats_${team}_${category}_${season}`
- Categories: `passing`, `rebounding`
- **No changes needed**

## Implementation Plan

### Phase 1: Bulk Play Type Cache Endpoint
1. Create `/api/cache/play-types-bulk` endpoint
2. Fetches all 11 play types sequentially
3. Stores in Supabase cache: `player_playtypes_bulk_${season}`
4. Update `/api/play-type-analysis` to use bulk cache

### Phase 2: Bulk Shot Chart Cache Endpoint
1. Create `/api/cache/shot-charts-bulk` endpoint
2. Fetches all players' shot charts
3. Stores in Supabase cache: `player_shotcharts_bulk_${season}`
4. Update `/api/shot-chart-enhanced` to use bulk cache

### Phase 3: Update Caching Scripts
1. Update `cache-everything.ps1` to call bulk endpoints first
2. Then individual player endpoints can use cached data
3. Much faster execution

## Cache Structure

### Play Types Bulk Cache
```typescript
{
  "PRBallHandler": {
    headers: ["PLAYER_ID", "PLAYER_NAME", "TEAM_ABBREVIATION", "PTS", "POSS", "PPP", ...],
    rows: [
      [123, "LeBron James", "LAL", 5.2, 10.1, 1.15, ...],
      [456, "Stephen Curry", "GSW", 6.8, 12.3, 1.22, ...],
      // ... all players
    ]
  },
  // ... 11 play types
}
```

### Shot Charts Bulk Cache
```typescript
{
  "123": { // playerId
    zones: [...],
    attempts: [...],
    average: 25.5,
    // ... shot chart data
  },
  "456": {
    // ...
  }
  // ... all players
}
```

## Benefits Summary

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Play Type API Calls** | 5,786 | 11 | **99.8% reduction** |
| **Shot Chart API Calls** | 526 | 1-2 | **99.6% reduction** |
| **Total Time** | 12-24 hours | 3-5 minutes | **99.7% faster** |
| **Timeout Errors** | Frequent | None | **100% eliminated** |
| **Cache Size** | ~500MB | ~50MB | **90% smaller** |

## Next Steps

1. ✅ Document strategy (this file)
2. ⏳ Create `/api/cache/play-types-bulk` endpoint
3. ⏳ Update `/api/play-type-analysis` to use bulk cache
4. ⏳ Create `/api/cache/shot-charts-bulk` endpoint
5. ⏳ Update `/api/shot-chart-enhanced` to use bulk cache
6. ⏳ Update `cache-everything.ps1` script
7. ⏳ Test with full player list

