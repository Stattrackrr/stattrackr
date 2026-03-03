#!/usr/bin/env node
/**
 * Check what game odds (ML, Spread, Total) are returned for AFL.
 * Optionally refreshes the cache first, then prints a readable summary.
 *
 * Usage (from project root; dev server must be running or set BASE_URL):
 *
 *   # Refresh cache then list all games and show first game's odds
 *   node scripts/check-afl-game-odds.js
 *
 *   # Refresh then show odds for a specific matchup
 *   node scripts/check-afl-game-odds.js "Sydney Swans" "Essendon"
 *
 *   # Don't refresh, just show what's in cache for a matchup
 *   node scripts/check-afl-game-odds.js "Sydney Swans" "Essendon" --no-refresh
 *
 * Optional: BASE_URL for deployed app
 *   BASE_URL=https://www.stattrackr.co node scripts/check-afl-game-odds.js "Sydney Swans" "Essendon"
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function hasData(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const v = Object.values(obj).find((x) => x != null && String(x) !== 'N/A' && String(x).trim() !== '');
  return v != null;
}

async function main() {
  const args = process.argv.slice(2);
  const noRefresh = args.includes('--no-refresh');
  const team = args.find((a) => a !== '--no-refresh') || null;
  const opponent = args.filter((a) => a !== '--no-refresh').length >= 2 ? args[args.indexOf(team) + 1] : null;

  console.log('AFL Game Odds Check');
  console.log('==================');
  console.log('Base URL:', BASE_URL);
  if (team) console.log('Team:', team);
  if (opponent) console.log('Opponent:', opponent);
  console.log('');

  if (!noRefresh) {
    console.log('Refreshing AFL odds cache...');
    const refreshRes = await fetch(`${BASE_URL}/api/afl/odds/refresh`);
    const refreshData = await refreshRes.json().catch(() => ({}));
    if (!refreshRes.ok) {
      console.log('Refresh failed:', refreshRes.status, refreshData?.error ?? refreshData);
      process.exit(1);
    }
    console.log('Refresh OK. Games in cache:', refreshData?.gamesCount ?? refreshData?.count ?? '?');
    if (refreshData?.eventsRefreshed != null) console.log('Player props events refreshed:', refreshData.eventsRefreshed);
    if (refreshData?.playerPropsOk === false) console.log('Player props warning:', refreshData?.playerPropsError ?? 'unknown');
    console.log('');
  }

  let url = `${BASE_URL}/api/afl/odds`;
  if (team) {
    url += `?team=${encodeURIComponent(team)}`;
    if (opponent) url += `&opponent=${encodeURIComponent(opponent)}`;
  }

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.log('Fetch failed:', res.status, data?.error ?? data);
    process.exit(1);
  }

  if (!data.success) {
    console.log('API returned success: false', data?.error ?? data?.message ?? '');
    process.exit(1);
  }

  const bookmakers = Array.isArray(data.data) ? data.data : [];
  const games = team ? bookmakers : (data.data || []);

  if (team && !opponent) {
    console.log('Response: single game bookmakers (data = array of bookmaker rows)');
    console.log('Home:', data.homeTeam ?? '—');
    console.log('Away:', data.awayTeam ?? '—');
    console.log('Bookmakers:', bookmakers.length);
    console.log('');
  }

  if (team && bookmakers.length > 0) {
    console.log('--- Bookmaker rows (first game) ---');
    for (let i = 0; i < bookmakers.length; i++) {
      const b = bookmakers[i];
      const h2h = hasData(b.H2H) ? `home=${b.H2H?.home} away=${b.H2H?.away}` : 'N/A';
      const spread = hasData(b.Spread) ? `line=${b.Spread?.line} over=${b.Spread?.over} under=${b.Spread?.under}` : 'N/A';
      const total = hasData(b.Total) ? `line=${b.Total?.line} over=${b.Total?.over} under=${b.Total?.under}` : 'N/A';
      console.log(`${(b.name || 'Unknown').padEnd(24)} | H2H: ${h2h}`);
      console.log(''.padEnd(24) + ` | Spread: ${spread}`);
      console.log(''.padEnd(24) + ` | Total: ${total}`);
      console.log('');
    }
    const hasSpread = bookmakers.some((b) => hasData(b.Spread));
    const hasTotal = bookmakers.some((b) => hasData(b.Total));
    const hasH2H = bookmakers.some((b) => hasData(b.H2H));
    console.log('Summary: H2H=' + (hasH2H ? 'yes' : 'no') + ', Spread=' + (hasSpread ? 'yes' : 'no') + ', Total=' + (hasTotal ? 'yes' : 'no'));
    return;
  }

  if (!team && Array.isArray(games) && games.length > 0) {
    console.log('Games in cache:', games.length);
    const first = games[0];
    const home = first.homeTeam ?? first.home_team ?? '—';
    const away = first.awayTeam ?? first.away_team ?? '—';
    const books = first.bookmakers ?? first.data ?? [];
    console.log('');
    console.log('First game:', home, 'vs', away);
    console.log('Bookmakers:', books.length);
    if (books.length > 0) {
      console.log('');
      for (let i = 0; i < Math.min(books.length, 5); i++) {
        const b = books[i];
        const name = b.name ?? b.title ?? 'Unknown';
        const h2h = hasData(b.H2H) ? `home=${b.H2H?.home} away=${b.H2H?.away}` : 'N/A';
        const spread = hasData(b.Spread) ? `line=${b.Spread?.line} over=${b.Spread?.over} under=${b.Spread?.under}` : 'N/A';
        const total = hasData(b.Total) ? `line=${b.Total?.line} over=${b.Total?.over} under=${b.Total?.under}` : 'N/A';
        console.log(`  ${name}`);
        console.log(`    H2H: ${h2h}`);
        console.log(`    Spread: ${spread}`);
        console.log(`    Total: ${total}`);
        console.log('');
      }
      const hasSpread = books.some((b) => hasData(b.Spread));
      const hasTotal = books.some((b) => hasData(b.Total));
      const hasH2H = books.some((b) => hasData(b.H2H));
      console.log('Summary: H2H=' + (hasH2H ? 'yes' : 'no') + ', Spread=' + (hasSpread ? 'yes' : 'no') + ', Total=' + (hasTotal ? 'yes' : 'no'));
    }
    return;
  }

  if (bookmakers.length === 0 && (!games || games.length === 0)) {
    console.log('No games or bookmakers in response.');
    console.log('Message:', data.message ?? '');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
