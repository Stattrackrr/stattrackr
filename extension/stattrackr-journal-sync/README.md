# StatTrackr Journal Sync Extension

Chrome MV3 extension for capturing sportsbook bets and handing them off to the StatTrackr journal import flow.

## Current scope
- Desktop Chrome only
- Sportsbet **Resulted** bet history bulk import (all sports on the page)
- Single-bet capture on confirmation / receipt pages
- Extra parser coverage scaffolded for TAB, Neds, Ladbrokes, and bet365 AU
- Review/approval in the StatTrackr journal (keep auto-add off until you trust capture)

## Load locally
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `extension/stattrackr-journal-sync`

## Configure
1. Open the extension popup
2. Set the StatTrackr origin, usually `https://stattrackr.co`
3. Leave `Auto-add after capture` off if you want everything to land in the journal review queue first
4. Turn on `Auto-capture on bet confirmation pages` only after you trust the sportsbook parser you are using

## Flow
1. Stay logged into StatTrackr in the same Chrome profile
2. On Sportsbet, open **My Bets → Resulted** and scroll to load your history
3. Click **Import all resulted bets** (or use single-bet capture on a receipt page)
4. The extension opens `StatTrackr -> /journal/import`
5. StatTrackr stages the bet in `imported_bets` and either:
   - promotes it straight into `bets` when auto-add is enabled
   - leaves it in the Imported bets review drawer inside the journal

## Notes
- The parser relies on visible page text and common receipt keywords, so sportsbook DOM changes can break capture quality.
- If capture confidence is low, keep auto-add off and approve from the journal review drawer.
