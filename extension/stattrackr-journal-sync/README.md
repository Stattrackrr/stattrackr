# StatTrackr Journal Sync Extension

Chrome MV3 extension for capturing sportsbook bets and handing them off to the StatTrackr journal import flow.

## Current scope
- Desktop Chrome only
- Sportsbet and TAB tuned first
- Extra parser coverage included for Neds, Ladbrokes, and bet365 AU
- Singles first, with review/approval in the StatTrackr journal

## Load locally
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `extension/stattrackr-journal-sync`

## Configure
1. Open the extension popup
2. Set the StatTrackr origin, usually `https://stattrackr.com`
3. Leave `Auto-add after capture` off if you want everything to land in the journal review queue first
4. Turn on `Auto-capture on bet confirmation pages` only after you trust the sportsbook parser you are using

## Flow
1. Stay logged into StatTrackr in the same Chrome profile
2. Open a supported sportsbook receipt / confirmation / my-bet page
3. Use `Send bet to StatTrackr` or let auto-capture fire
4. The extension opens `StatTrackr -> /journal/import`
5. StatTrackr stages the bet in `imported_bets` and either:
   - promotes it straight into `bets` when auto-add is enabled
   - leaves it in the Imported bets review drawer inside the journal

## Notes
- The parser relies on visible page text and common receipt keywords, so sportsbook DOM changes can break capture quality.
- If capture confidence is low, keep auto-add off and approve from the journal review drawer.
