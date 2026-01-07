# Security & Performance Audit: app/nba/page.tsx

## 🔒 Security Issues

### Critical
1. **JSON.parse without try-catch** (Lines 281-283, 777, 787, 833, 905, 1953, 1977, 2076, 2411)
   - Risk: Malformed JSON in localStorage/sessionStorage can crash the app
   - Fix: Wrap all JSON.parse calls in try-catch blocks
   - Impact: High - can cause app crashes

2. **Unbounded sessionStorage usage** (Multiple locations)
   - Risk: QuotaExceededError when storing large player props arrays
   - Current: Storing entire `playerProps` array (could be 1000+ items)
   - Fix: Implement size limits, compression, or pagination
   - Impact: Medium - can cause storage failures

3. **Missing input validation on search query** (Line 1876)
   - Risk: XSS if searchQuery contains malicious content (though React escapes by default)
   - Current: Only `.trim()` applied
   - Fix: Add length limits and sanitization
   - Impact: Low (React protects, but best practice)

### Medium
4. **User-controlled data in URLs** (Lines 1876, 3666, 4749)
   - Risk: URL manipulation, though `encodeURIComponent` is used
   - Status: Properly encoded, but no validation
   - Fix: Validate player names, stats, lines before navigation
   - Impact: Low-Medium

5. **Large data structures in localStorage** (Lines 1939-1941, 2086)
   - Risk: Storage quota exceeded, performance degradation
   - Current: Storing arrays/sets without size checks
   - Fix: Add size validation before storing
   - Impact: Medium

## ⚡ Performance Issues

### Critical
1. **Massive file size** (5,268 lines)
   - Impact: Slow initial load, difficult to maintain
   - Fix: Split into smaller components:
     - `PlayerPropsTable.tsx`
     - `PlayerPropsFilters.tsx`
     - `PlayerPropsCard.tsx`
     - `TipoffCountdown.tsx` (already separate)
   - Priority: High

2. **Excessive useEffect hooks** (31 instances)
   - Impact: Unnecessary re-renders, complex dependency management
   - Issues:
     - Line 2427: Missing dependency `calculatePlayerAverages` (eslint disabled)
     - Line 1063: Polling interval not cleaned up properly in all cases
     - Line 2117: Missing dependencies in dependency array
   - Fix: Consolidate related effects, fix dependencies
   - Priority: High

3. **Large computations in render** (80+ map/filter/forEach operations)
   - Impact: Blocking main thread, janky UI
   - Examples:
     - Line 2126: `filteredPlayerProps` - filters entire array on every render
     - Line 2179: `sortedPlayerProps` - sorts entire array
     - Line 2245: `uniquePlayerProps` - deduplicates entire array
   - Fix: Use `useMemo` more aggressively, consider virtualization
   - Priority: High

4. **Unbounded in-memory cache** (Lines 1194-1195)
   ```typescript
   const playerStatsCache = new Map<string, any[]>();
   const playerStatsPromiseCache = new Map<string, Promise<any[]>>();
   ```
   - Impact: Memory leak over time, especially with many players
   - Fix: Implement LRU cache with size limits
   - Priority: High

5. **Continuous requestAnimationFrame loop** (Lines 363-368)
   - Impact: Unnecessary CPU usage when dropdowns are open
   - Current: Runs continuously even when not needed
   - Fix: Only run when position actually needs updating
   - Priority: Medium-High

### High Priority
6. **Multiple rapid sessionStorage writes** (Lines 2474, 2498-2499)
   - Impact: Performance degradation, potential quota issues
   - Current: Writing entire arrays multiple times in quick succession
   - Fix: Debounce writes, batch updates
   - Priority: High

7. **Missing cleanup in useEffect** (Line 2427)
   - Impact: Memory leaks, unnecessary calculations
   - Current: `calculateMissingStats` runs on every `paginatedPlayerProps` change
   - Fix: Add cleanup, cancel in-flight calculations
   - Priority: High

8. **No memoization on expensive operations**
   - Examples:
     - `getGameForProp` (Line 1996) - memoized with useCallback ✓
     - `calculatePlayerAverages` (Line 1198) - not memoized
     - `getStatLabel` (Line 1890) - not memoized
   - Fix: Memoize functions that are recreated on every render
   - Priority: Medium-High

9. **Large state updates** (Lines 2484-2506)
   - Impact: Expensive re-renders
   - Current: Updating entire `playerProps` array for single prop change
   - Fix: Use functional updates, consider normalized state
   - Priority: Medium

10. **No pagination/virtualization for large lists**
    - Impact: Rendering 20+ complex table rows can be slow
    - Current: All paginated props rendered at once
    - Fix: Implement virtual scrolling for tables
    - Priority: Medium

### Medium Priority
11. **Unnecessary re-renders from object references**
    - Impact: Child components re-render unnecessarily
    - Examples: `playerProps` array reference changes frequently
    - Fix: Use stable references, React.memo on child components
    - Priority: Medium

12. **Multiple API calls that could be batched**
    - Lines 692-701: Preloading team data in batches (good)
    - Lines 1352-1354: Sequential season fetches (could be parallel)
    - Fix: Batch related API calls
    - Priority: Medium

13. **No error boundaries**
    - Impact: One error crashes entire page
    - Fix: Add React error boundaries around major sections
    - Priority: Medium

14. **Large dependency arrays in useMemo** (Line 2241)
    - Impact: Recomputes frequently
    - Current: 9 dependencies
    - Fix: Split into smaller memoized values
    - Priority: Low-Medium

## 📋 Recommendations Priority Order

### Immediate (This Week)
1. ✅ Fix JSON.parse error handling
2. ✅ Add size limits to sessionStorage writes
3. ✅ Fix missing useEffect dependencies
4. ✅ Add cleanup to calculateMissingStats useEffect
5. ✅ Implement LRU cache for playerStatsCache

### Short Term (This Month)
6. Split file into smaller components
7. Add memoization to expensive computations
8. Debounce sessionStorage writes
9. Add error boundaries
10. Optimize state updates

### Long Term (Next Quarter)
11. Implement virtual scrolling
12. Normalize state structure
13. Add comprehensive input validation
14. Implement request batching
15. Add performance monitoring

## 🔍 Code Quality Issues

1. **Disabled ESLint rules** (Line 2521, 1969, 1991)
   - Risk: Hidden dependency issues
   - Fix: Address root cause, don't disable rules

2. **Magic numbers** (Lines 300, 500, 707, 1053, etc.)
   - Fix: Extract to constants
   - Examples: `300` (debounce), `500` (batch delay), `30 * 60 * 1000` (cache TTL)

3. **Large functions** (Lines 1198-1870: `calculatePlayerAverages` - 672 lines)
   - Fix: Split into smaller, testable functions

4. **Inconsistent error handling**
   - Some places use try-catch, others don't
   - Fix: Standardize error handling pattern

## 📊 Metrics

- **File Size**: 5,268 lines (should be < 500 per file)
- **useEffect Hooks**: 31 (target: < 10 per component)
- **useMemo Hooks**: 8 (could use more)
- **useCallback Hooks**: 1 (could use more)
- **Map/Filter Operations**: 80+ (many in render)
- **sessionStorage Writes**: 64 instances
- **API Calls**: 10+ different endpoints

## 🎯 Quick Wins

1. Wrap JSON.parse in try-catch (5 min fix)
2. Add size check before sessionStorage.setItem (10 min fix)
3. Memoize `getStatLabel` function (2 min fix)
4. Add cleanup to calculateMissingStats (5 min fix)
5. Extract magic numbers to constants (15 min fix)

Total Quick Win Time: ~40 minutes
Expected Performance Improvement: 10-15%

