# Manual Stat Edits in dvp_store Files

## How It Works

The DVP endpoint reads stats **directly** from `data/dvp_store/2025/{TEAM}.json` files. When you manually edit player stats in these files, those changes **will be used** in DVP calculations.

## Editing Stats in VS Code

1. **Open the file**: `data/dvp_store/2025/{TEAM}.json`
2. **Find the player** you want to edit (search by name)
3. **Edit the stats** directly:
   ```json
   {
     "playerId": 338,
     "name": "Svi Mykhailiuk",
     "bucket": "SF",
     "isStarter": true,
     "pts": 5,        // ← Edit this
     "reb": 2,        // ← Edit this
     "ast": 4,        // ← Edit this
     "fg3m": 1,
     "fg3a": 3,
     "fgm": 2,
     "fga": 5,
     "stl": 1,
     "blk": 0,
     "min": "25"
   }
   ```
4. **Save the file** (Ctrl+S)

## Important Notes

### ⚠️ Auto-Ingest Will Overwrite Your Changes

The auto-ingest process (`/api/dvp/ingest-nba-all`) will **overwrite** your manual edits when it runs. To prevent this:

1. **Commit your changes to git** so they're preserved
2. **Don't run re-ingest** for games you've manually edited
3. Or modify the ingest process to skip games you've manually edited

### ✅ Stats That Can Be Edited

- `pts` - Points
- `reb` - Rebounds  
- `ast` - Assists
- `fg3m` - 3-pointers made
- `fg3a` - 3-pointers attempted
- `fgm` - Field goals made
- `fga` - Field goals attempted
- `stl` - Steals
- `blk` - Blocks
- `min` - Minutes played
- `bucket` - Position (but use `player_positions/` files instead)

### 🔄 To See Changes

1. **Commit your changes**:
   ```powershell
   git add data/dvp_store/2025/
   git commit -m "Manual stat corrections"
   git push
   ```

2. **Clear cache** on the dashboard:
   - Hard refresh: `Ctrl + Shift + R`
   - Or add `?refresh=1` to URL

3. **Wait for deployment** (if on Vercel)

## Best Practice

If you're manually correcting stats, consider:
1. Making a backup of the file first
2. Documenting why you changed the stats
3. Committing changes immediately so they're not lost
4. Being careful with re-ingest - it will overwrite your changes

