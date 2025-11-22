# Position Override System

## Overview

The position override system allows you to manually correct player positions that are incorrectly assigned by the automatic depth chart detection. **Custom positions now take priority over stored game data**, so once you set a position override, it will be used for all games.

## How It Works

1. **Priority Order:**
   - Custom positions (from `master.json` or team files) - **HIGHEST PRIORITY**
   - Stored game data positions - Fallback
   - Automatic detection - Last resort

2. **File Structure:**
   - `data/player_positions/master.json` - Global position overrides (applies to all teams)
   - `data/player_positions/teams/{TEAM}.json` - Team-specific position overrides

## Methods to Update Positions

### Method 0: Fetch Actual Positions from NBA Stats API (RECOMMENDED - Most Accurate)

**Fetches real game positions from NBA Stats API boxscores (START_POSITION field):**

```bash
# Fetch actual positions for a specific team
node scripts/fetch-actual-positions.js --team MIL --season 2025

# Fetch for all teams
node scripts/fetch-actual-positions.js --all --season 2025

# Fetch and auto-apply updates (min 5 games)
node scripts/fetch-actual-positions.js --team MIL --season 2025 --min-games 5 --apply
```

**Why this is better:**
- Uses **actual game data** from NBA Stats API (START_POSITION field)
- Not affected by injuries or depth chart errors
- Shows the **real position** each player started at in each game
- More accurate than analyzing stored DVP data (which may have incorrect positions)

**What it does:**
1. Fetches team game log from NBA Stats API
2. For each game, fetches boxscore with START_POSITION
3. Analyzes actual positions played (not depth chart guesses)
4. Recommends most common position based on real game data

**Example output:**
```
⚠️  UPDATE Giannis Antetokounmpo    | Current: SF      | Recommended: PF | 20G | 95% | PF:19(19S), SF:1(1S)
✅ OK     Khris Middleton            | Current: SF      | Recommended: SF | 18G | 100% | SF:18(18S)
```

**Then apply the recommendations:**

```bash
# Review the analysis, then apply
node scripts/fetch-actual-positions.js --team MIL --season 2025 --apply
```

### Method 0.5: Analyze Historical Positions from Stored Data (Less Accurate)

**Note:** This method uses stored DVP data which may have incorrect positions due to depth chart scraping errors. Use Method 0 (NBA Stats API) instead for accuracy.

```bash
# Analyze a specific team (from stored DVP data)
node scripts/analyze-historical-positions.js --team MIL

# Analyze all teams
node scripts/analyze-historical-positions.js --all
```

**Via API:**

```bash
# Get position analysis for a team (from stored data)
curl "http://localhost:3000/api/positions/analyze?team=MIL&minGames=5"
```

### Method 1: API Endpoint (Recommended for Development)

**Update positions via API:**

```bash
# Update master positions
curl -X POST http://localhost:3000/api/positions/update \
  -H "Content-Type: application/json" \
  -d '{
    "updates": {
      "giannis antetokounmpo": "PF",
      "khris middleton": "SF",
      "brook lopez": "C"
    }
  }'

# Update team-specific positions
curl -X POST http://localhost:3000/api/positions/update \
  -H "Content-Type: application/json" \
  -d '{
    "team": "MIL",
    "updates": {
      "giannis antetokounmpo": "PF",
      "khris middleton": "SF"
    }
  }'
```

**View current positions:**

```bash
# View master positions
curl http://localhost:3000/api/positions/update

# View team positions
curl http://localhost:3000/api/positions/update?team=MIL
```

### Method 3: Bulk Update Script

**Create a JSON file with updates:**

```json
// positions.json
{
  "giannis antetokounmpo": "PF",
  "khris middleton": "SF",
  "brook lopez": "C",
  "damian lillard": "PG",
  "malik beasley": "SG"
}
```

**Run the script:**

```bash
# Update master positions
node scripts/bulk-update-positions.js --master --file positions.json

# Update team-specific positions
node scripts/bulk-update-positions.js --team MIL --file positions.json

# Inline updates
node scripts/bulk-update-positions.js --team MIL --updates '{"giannis antetokounmpo":"PF","khris middleton":"SF"}'
```

### Method 4: Direct File Editing

Edit the JSON files directly:

```json
// data/player_positions/master.json
{
  "positions": {
    "giannis antetokounmpo": "PF",
    "khris middleton": "SF",
    "brook lopez": "C"
  },
  "aliases": {}
}

// data/player_positions/teams/MIL.json
{
  "positions": {
    "giannis antetokounmpo": "PF",
    "khris middleton": "SF"
  },
  "aliases": {}
}
```

## Position Values

Valid positions:
- `PG` - Point Guard
- `SG` - Shooting Guard
- `SF` - Small Forward
- `PF` - Power Forward
- `C` - Center

## Player Name Formatting

Player names are automatically normalized:
- Converted to lowercase
- Special characters removed
- Multiple spaces collapsed

Examples:
- `"Giannis Antetokounmpo"` → `"giannis antetokounmpo"`
- `"Kris Middleton"` → `"khris middleton"`
- `"D'Angelo Russell"` → `"dangelo russell"`

## Team-Specific vs Master

- **Master file**: Applies to all teams. Use for players who consistently play the same position regardless of team.
- **Team files**: Override master for specific teams. Use when a player's position varies by team or when correcting team-specific errors.

## Position Analysis Methods

### Method A: NBA Stats API (RECOMMENDED - Most Accurate)

Fetches actual game positions directly from NBA Stats API boxscores:

1. **Fetches team game log** - Gets all games for the season from NBA Stats API
2. **Fetches boxscores** - For each game, gets the boxscore with START_POSITION field
3. **Extracts real positions** - Uses actual positions players started at (not depth chart guesses)
4. **Not affected by injuries** - Shows real positions regardless of depth chart errors
5. **Analyzes and recommends** - Determines most common position based on actual game data

**Use this method:** `node scripts/fetch-actual-positions.js --team MIL --season 2025`

### Method B: Stored DVP Data (Less Accurate)

Analyzes positions from stored game data (may have errors):

1. **Analyze stored game data** - Looks at every game in `data/dvp_store/{season}/{TEAM}.json`
2. **Count position occurrences** - Tracks how many times each player played each position
3. **Prioritize starter positions** - If a player started at a position, that counts more heavily
4. **Recommend most common position** - Suggests the position the player played most often
5. **Calculate confidence** - Shows percentage of games played at recommended position

**Note:** This method uses positions that were assigned during game ingestion, which may be incorrect due to depth chart scraping errors or injuries.

**Use this method:** `node scripts/analyze-historical-positions.js --team MIL`

**Example output:**
```
⚠️  UPDATE Giannis Antetokounmpo    | Current: SF      | Recommended: PF | 20G | 95% | PF:19(19S), SF:1(0S)
✅ OK     Khris Middleton            | Current: SF      | Recommended: SF | 18G | 100% | SF:18(18S)
```

This shows:
- Giannis played PF in 19 games (all as starter) and SF in 1 game → Should be PF
- Khris played SF in all 18 games → Current position is correct

## Important Notes

1. **Custom positions override stored game data** - Once you set a position, it will be used for all historical and future games until you change it.

2. **Use historical analysis first** - Before manually setting positions, run the analysis script to see what positions players actually played in past games. This gives you data-driven recommendations.

3. **Team files override master** - If a player has a position in both master and team file, the team file takes precedence.

4. **Changes take effect immediately** - No need to reprocess games. The system reads position files on every request.

5. **Serverless limitation** - Position updates via API are not supported in serverless environments (Vercel production). Use the script or direct file editing for production updates.

## Troubleshooting

**Position not updating?**
- Check that the player name is normalized correctly
- Verify the position value is one of: PG, SG, SF, PF, C
- Check if there's a conflicting position in the other file (master vs team)

**Want to remove a position override?**
- Delete the entry from the JSON file, or set it to an empty string (will fall back to stored game data)

**Need to see what positions are currently set?**
- Use the GET endpoint: `curl http://localhost:3000/api/positions/update?team=MIL`
- Or check the JSON files directly

