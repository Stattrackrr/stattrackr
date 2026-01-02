# Dashboard Component Split - Comprehensive Plan

## Current State
- **File Size**: 19,266 lines
- **Goal**: Split into ~20 smaller files with main `page.tsx` as orchestrator (~300-500 lines)

## Strategy
1. **Phase 1**: Extract large odds/analysis components (highest impact)
2. **Phase 2**: Extract chart control components
3. **Phase 3**: Extract custom hooks (data fetching logic)
4. **Phase 4**: Extract remaining UI components
5. **Phase 5**: Refactor main component to orchestrator

## Phase 1: Large Components (Start Here)
These are the biggest components that will have the most impact:

### 1.1 OfficialOddsCard (~500 lines)
- **Location**: Line ~5298
- **File**: `components/odds/OfficialOddsCard.tsx`
- **Dependencies**: oddsUtils, constants, types

### 1.2 BestOddsTable (~400 lines)
- **Location**: Line ~6437
- **File**: `components/odds/BestOddsTable.tsx`
- **Dependencies**: oddsUtils, constants, types

### 1.3 BestOddsTableDesktop (~400 lines)
- **Location**: Line ~6871
- **File**: `components/odds/BestOddsTableDesktop.tsx`
- **Dependencies**: oddsUtils, constants, types

### 1.4 PositionDefenseCard (~400 lines)
- **Location**: Line ~5504
- **File**: `components/odds/PositionDefenseCard.tsx`
- **Dependencies**: constants, types, utils

### 1.5 OpponentAnalysisCard (~300 lines)
- **Location**: Line ~6121
- **File**: `components/odds/OpponentAnalysisCard.tsx`
- **Dependencies**: constants, types, utils

## Phase 2: Chart Components
### 2.1 ChartControls (~2000 lines) ⚠️ LARGEST
- **Location**: Line ~2650
- **File**: `components/charts/ChartControls.tsx`
- **Dependencies**: chart components, constants, types, utils

### 2.2 ChartContainer (~200 lines)
- **Location**: Line ~4980
- **File**: `components/charts/ChartContainer.tsx`
- **Dependencies**: ChartControls, chart components

## Phase 3: Custom Hooks
Extract data fetching and state management logic:

### 3.1 usePlayerStats (~300 lines)
- **File**: `hooks/usePlayerStats.ts`
- **Logic**: Player stats fetching, filtering, processing

### 3.2 useGameData (~200 lines)
- **File**: `hooks/useGameData.ts`
- **Logic**: Game data processing, filtering, timeframe logic

### 3.3 useOdds (~250 lines)
- **File**: `hooks/useOdds.ts`
- **Logic**: Odds fetching, processing, line movement

### 3.4 useAdvancedStats (~150 lines)
- **File**: `hooks/useAdvancedStats.ts`
- **Logic**: Advanced stats calculations

## Phase 4: Remaining UI Components
### 4.1 PlayerBoxScore (~300 lines) - Already partially extracted?
- **File**: `components/ui/PlayerBoxScore.tsx`
- **Check**: May already be extracted

## Phase 5: Main Component Refactor
- Refactor `NBADashboardContent` to be orchestrator
- Import all extracted components
- Remove all extracted code
- Target: ~300-500 lines

## Execution Order
1. Start with Phase 1 (largest components)
2. Test after each extraction
3. Build verification after each phase
4. Continue systematically

## Success Criteria
- ✅ Main `page.tsx` < 1000 lines (ideally < 500)
- ✅ Each component file < 500 lines (ideally < 300)
- ✅ All tests pass
- ✅ Build succeeds
- ✅ No functionality broken

