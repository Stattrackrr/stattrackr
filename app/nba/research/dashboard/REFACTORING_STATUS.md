# Refactoring Status - Final Steps

## ✅ Completed

1. **Extracted 25+ modules** - Types, constants, utilities, and components
2. **Added imports** to `page.tsx` from all extracted modules
3. **Created component files** - Charts, UI components, utilities

## ⚠️ Remaining Work

The `page.tsx` file still contains **duplicate code** that needs to be removed:

### Duplicate Code to Remove:

1. **Types** (lines ~55-440):
   - `DepthPos`, `DepthChartPlayer`, `DepthChartData` (already in types.ts)
   - `BookRow`, `DerivedOdds`, `MovementRow`, `MatchupInfo` (already in types.ts)
   - `OfficialOddsCardProps`, `BallDontLieGame`, `BallDontLieStats` (already in types.ts)
   - `BdlSearchResult`, `EspnPlayerData`, `SavedSession` (already in types.ts)

2. **Constants** (lines ~73-660):
   - `PLACEHOLDER_BOOK_ROWS` (already in constants.ts)
   - `TEAM_ID_TO_ABBR`, `ABBR_TO_TEAM_ID`, `TEAM_FULL_NAMES` (already in constants.ts)
   - `ESPN_LOGO_SLUG`, `ESPN_FILE_ABBR`, logo functions (already in constants.ts)
   - `opponentDefensiveStats`, `teamRatings`, `teamPace`, `teamReboundPct` (already in constants.ts)
   - `PLAYER_STAT_OPTIONS`, `TEAM_STAT_OPTIONS`, `CHART_CONFIG` (already in constants.ts)

3. **Utility Functions** (lines ~132-600):
   - `mergeBookRowsByBaseName` (already in utils.ts)
   - `parseBallDontLieTipoff`, `currentNbaSeason`, `parseMinutes` (already in utils.ts)
   - `getStatValue`, `getGameStatValue` (already in utils.ts)
   - `getOpponentDefensiveRank`, `getOpponentDefensiveRankColor`, `getOrdinalSuffix` (already in utils.ts)
   - `getTeamRating`, `getTeamRank`, `getTeamPace`, `getTeamReboundPct` (already in utils.ts)
   - `getPaceRank`, `getReboundRank`, `getRankColor` (already in utils.ts)
   - `getPlayerCurrentTeam`, `getOpponentTeam` (already in utils.ts)

4. **Components** (lines ~708-2100):
   - `StaticLabelList` (already in components/charts/StaticLabelList.tsx)
   - `CustomXAxisTick` (already in components/charts/CustomXAxisTick.tsx)
   - `PlayerBoxScore` (already in components/ui/PlayerBoxScore.tsx)
   - `PureChart` (already in components/charts/PureChart.tsx)
   - `StatPill`, `TimeframeBtn`, `HomeAwaySelect`, `OverRatePill` (already in components/ui/)
   - `OpponentSelector` (already in components/ui/OpponentSelector.tsx)

5. **Chart Components** (lines ~1200-1800):
   - `StaticBarsChart`, `DynamicReferenceLineChart`, `StaticBettingLineOverlay` (already extracted)
   - `StatsBarChart` (already in components/charts/StatsBarChart.tsx)

## 📊 Expected Result

After removing duplicates:
- **Current**: ~11,845 lines
- **Expected**: ~8,000-9,000 lines (removing ~2,000-3,000 lines of duplicates)
- **Further reduction possible**: Extract remaining large components (ChartControls, odds components)

## 🎯 Next Steps

1. Remove duplicate type definitions
2. Remove duplicate constants
3. Remove duplicate utility functions
4. Remove duplicate component definitions
5. Test to ensure everything still works
6. (Optional) Extract remaining large components

## ⚡ Quick Win

The imports are already added, so the code will work. The duplicates just make the file larger than necessary. Removing them will:
- Reduce file size significantly
- Improve IDE performance
- Make the code easier to navigate
- Reduce confusion about which definition to use






