# Fixing DvP Positions Guide

## The Problem
DvP positions are currently using depth charts which don't update per game and can include injured players, leading to incorrect starting positions.

## Solution: Use Actual Starting Lineups

### Option 1: NBA Stats API (Official Source)
The NBA Stats API `boxscoretraditionalv2` endpoint has `START_POSITION` field which shows the actual position each player started at.

**Endpoint:** `/api/dvp/fetch-nba-starting-positions?team=MIL&season=2025`

**Pros:**
- Official NBA data
- Most accurate
- Per-game data

**Cons:**
- Can be slow/timeout
- May require retries

### Option 2: Basketball-Reference (Historical Data)
Basketball-Reference has starting lineups for every game.

**URL Format:** `https://www.basketball-reference.com/teams/MIL/2026_start.html`

**Pros:**
- Reliable historical data
- Easy to verify manually
- Complete season data

**Cons:**
- Requires HTML parsing
- May need to handle different formats

### Option 3: Manual Verification
Since you're finding many websites with starting lineups, you can:

1. **Use the position files directly:**
   - Edit `data/player_positions/teams/{TEAM}.json`
   - Update positions based on what you see on websites
   - Run DvP re-ingest to apply changes

2. **Bulk update script:**
   - Create a CSV or JSON file with player positions
   - Use a script to update all position files at once

## Recommended Approach

1. **For current season (2025-26):**
   - Try NBA Stats API endpoint (may need retries if it times out)
   - If that fails, use Basketball-Reference scraping
   - As fallback, manually verify from websites you're finding

2. **For historical seasons:**
   - Use Basketball-Reference (most reliable)
   - Or use stored DvP data if positions were correct when ingested

## Quick Fix Script

```powershell
# Option A: Call NBA Stats API endpoint (e.g. in browser or curl):
# GET /api/dvp/fetch-nba-starting-positions?team=MIL&season=2025
# Then update data/player_positions/teams/MIL.json from the response and run reingest.

# Option B: Manually edit position files, then reingest:
# Edit: data/player_positions/teams/MIL.json
.\scripts\reingest-dvp-all.ps1
```

## Websites with Starting Lineups

Based on your research, these sites have starting lineups:
- Rotowire
- Underdog Fantasy  
- TheScore
- Yahoo Sports
- Basketball-Reference
- NBA.com official

We can add scraping for any of these if you find one that's particularly reliable and easy to access.

