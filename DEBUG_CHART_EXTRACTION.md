# Chart Extraction Debugging Plan

## Problem
Every time we extract components, the chart bars disappear. We need to systematically identify why.

## Current State
- `page.tsx` has an inline `PureChart` component (line 2048) that works
- There's also an extracted `PureChart.tsx` component that's different
- `ChartContainer` is currently inline in `page.tsx` (line 4438)

## Key Differences Found

### Inline PureChart (page.tsx line 2048):
```typescript
{isLoading || !chartData || chartData.length === 0 ? (
  // skeleton loading
) : (
  <StatsBarChart ... />
)}
```

### Extracted PureChart.tsx:
```typescript
{isLoading ? (
  // simple loading spinner
) : (
  <StatsBarChart ... />
)}
```

## Debugging Strategy

### Step 1: Verify Current Working State
- [ ] Confirm bars are showing after revert
- [ ] Note which PureChart is being used (inline vs extracted)

### Step 2: Minimal Test Extraction
Instead of extracting the entire ChartContainer, try:
1. Extract ONLY a small wrapper component
2. Test if bars still show
3. If they do, gradually add more code
4. If they don't, we know the issue is with the extraction mechanism itself

### Step 3: Compare Component Definitions
- [ ] Compare inline PureChart vs extracted PureChart
- [ ] Check if memo comparison functions are identical
- [ ] Verify all props are being passed correctly

### Step 4: Add Comprehensive Logging
Add console logs at each level:
- ChartContainer render
- PureChart render  
- StatsBarChart render
- Chart data at each level

### Step 5: Test Incremental Changes
1. First: Just move PureChart import (don't change code)
2. Second: Change one prop at a time
3. Third: Test memo removal
4. Fourth: Test with/without guards

## Potential Root Causes

1. **Memoization Issue**: The memo comparison might be preventing re-renders when data changes
2. **Import Path Issue**: Maybe the extracted component isn't being imported correctly
3. **Component Identity**: React might be treating the extracted component differently
4. **Data Flow**: Props might not be flowing correctly through the extracted component
5. **Timing Issue**: The component might render before data is available
6. **Client Component Directive**: Missing or incorrect 'use client' directive

## Next Steps
1. Create a minimal test case
2. Add logging to track data flow
3. Test one change at a time
4. Document what breaks and when


