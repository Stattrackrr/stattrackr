/**
 * Rebuild journal bets for a user using REAL AFL disposals game logs.
 *
 * Purpose:
 * - Remove existing bets for a user (email lookup via Supabase auth admin API)
 * - Insert AFL single disposals bets only
 * - Use real game dates/opponents/disposals from your AFL API route
 * - Stake is fixed at $50 AUD
 * - Bookmakers limited to PointsBet / Sportsbet
 * - Clearly label rows as demo in market + selection text
 *
 * Usage:
 *   node scripts/rebuild-afl-demo-journal-bets.js --apply
 *
 * Options:
 *   --email=admin@stattrackr.co
 *   --season=2026
 *   --max-players=60
 *   --max-bets=300
 *   --max-per-day=0
 *   --base-url=https://www.stattrackr.co
 *   --apply            Actually delete/insert (without this flag, dry-run only)
 *
 * Env required (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const DEFAULT_EMAIL = 'admin@stattrackr.co';
const DEFAULT_SEASON = 2026;
const DEFAULT_MAX_PLAYERS = 60;
const DEFAULT_MAX_BETS = 300;
const DEFAULT_MAX_PER_DAY = 0; // 0 means no per-day cap
const TARGET_WIN_RATE = 0.68;
const STAKE_OPTIONS = [40, 55, 70, 85, 100, 125, 150];
const BOOKMAKERS = ['PointsBet', 'Sportsbet'];
const ODDS_OPTIONS = [1.83, 1.87, 1.9, 1.95, 2.0];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fallbackBaseUrl =
  process.env.PROD_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'http://localhost:3000';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    'Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function parseArgs(argv) {
  const args = {
    email: DEFAULT_EMAIL,
    season: DEFAULT_SEASON,
    maxPlayers: DEFAULT_MAX_PLAYERS,
    maxBets: DEFAULT_MAX_BETS,
    maxPerDay: DEFAULT_MAX_PER_DAY,
    apply: false,
    baseUrl: fallbackBaseUrl,
  };

  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw.startsWith('--email=')) args.email = raw.split('=').slice(1).join('=').trim();
    else if (raw.startsWith('--season=')) args.season = Number(raw.split('=')[1]);
    else if (raw.startsWith('--max-players=')) args.maxPlayers = Number(raw.split('=')[1]);
    else if (raw.startsWith('--max-bets=')) args.maxBets = Number(raw.split('=')[1]);
    else if (raw.startsWith('--max-per-day=')) args.maxPerDay = Number(raw.split('=')[1]);
    else if (raw.startsWith('--base-url=')) args.baseUrl = raw.split('=').slice(1).join('=').trim();
  }

  if (!Number.isFinite(args.season) || args.season < 2000) args.season = DEFAULT_SEASON;
  if (!Number.isFinite(args.maxPlayers) || args.maxPlayers < 1) args.maxPlayers = DEFAULT_MAX_PLAYERS;
  if (!Number.isFinite(args.maxBets) || args.maxBets < 1) args.maxBets = DEFAULT_MAX_BETS;
  if (!Number.isFinite(args.maxPerDay) || args.maxPerDay < 0) args.maxPerDay = DEFAULT_MAX_PER_DAY;
  if (!args.email || !args.email.includes('@')) args.email = DEFAULT_EMAIL;
  if (!args.baseUrl) args.baseUrl = fallbackBaseUrl;

  args.baseUrl = args.baseUrl.replace(/\/+$/, '');
  return args;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const users = data?.users || [];

    const match = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (match) return match;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function seededFloat(seedText) {
  const h = hashString(seedText);
  return (h % 100000) / 100000;
}

function roundTextToNumber(roundLabel) {
  if (!roundLabel) return null;
  const m = String(roundLabel).match(/-?\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function buildPlayerLine(priorDisposals, seasonAvg, seedKey) {
  const baseline =
    priorDisposals.length > 0
      ? priorDisposals.reduce((s, n) => s + n, 0) / priorDisposals.length
      : seasonAvg;
  const jitter = (seededFloat(seedKey) * 4) - 2; // [-2, +2]
  const raw = baseline + jitter;
  const clamped = Math.max(10.5, Math.min(45.5, raw));
  return roundToHalf(clamped);
}

function pickSideForTargetResult(actualDisposals, initialLine, shouldWin, seedKey) {
  let line = initialLine;
  let overUnder;

  if (actualDisposals > line) {
    overUnder = shouldWin ? 'over' : 'under';
  } else if (actualDisposals < line) {
    overUnder = shouldWin ? 'under' : 'over';
  } else {
    const nudgeUp = seededFloat(`${seedKey}|nudge`) >= 0.5;
    line = nudgeUp ? line + 0.5 : line - 0.5;
    if (shouldWin) {
      overUnder = nudgeUp ? 'under' : 'over';
    } else {
      overUnder = nudgeUp ? 'over' : 'under';
    }
  }

  return { line, overUnder };
}

function pickStake(seedKey) {
  const idx = Math.floor(seededFloat(`${seedKey}|stake`) * STAKE_OPTIONS.length) % STAKE_OPTIONS.length;
  return STAKE_OPTIONS[idx];
}

function buildBetFromGame({
  userId,
  playerName,
  team,
  game,
  line,
  overUnder,
  bookmaker,
  odds,
  stake,
}) {
  const actual = Number(game.disposals);
  const result = overUnder === 'over' ? (actual > line ? 'win' : 'loss') : (actual < line ? 'win' : 'loss');
  const date = game.date;
  const ouLabel = overUnder === 'over' ? 'Over' : 'Under';

  return {
    user_id: userId,
    date,
    sport: 'AFL',
    market: 'AFL Player Disposals Single [DEMO]',
    selection: `[DEMO] ${playerName} Disposals ${ouLabel} ${line}`,
    stake,
    currency: 'AUD',
    odds,
    result,
    status: 'completed',
    player_name: playerName,
    team: team || null,
    opponent: game.opponent || null,
    stat_type: 'disposals',
    line,
    over_under: overUnder,
    actual_value: actual,
    game_date: date,
    bookmaker,
  };
}

async function buildBetsFromApi({ baseUrl, season, userId, maxPlayers, maxBets, maxPerDay }) {
  const leagueUrl = `${baseUrl}/api/afl/league-player-stats?season=${encodeURIComponent(season)}`;
  const league = await fetchJson(leagueUrl);
  const players = Array.isArray(league?.players) ? league.players : [];

  const sortedPlayers = players
    .filter((p) => Number.isFinite(Number(p?.disposals)))
    .sort((a, b) => Number(b.disposals) - Number(a.disposals))
    .slice(0, maxPlayers);

  const candidates = [];

  for (const p of sortedPlayers) {
    const playerName = String(p.name || '').trim();
    const team = String(p.team || '').trim();
    if (!playerName) continue;

    const logsUrl =
      `${baseUrl}/api/afl/player-game-logs?season=${encodeURIComponent(season)}` +
      `&player_name=${encodeURIComponent(playerName)}` +
      (team ? `&team=${encodeURIComponent(team)}` : '');

    let payload;
    try {
      payload = await fetchJson(logsUrl);
    } catch (err) {
      console.warn(`Skipping ${playerName}: ${err.message}`);
      continue;
    }

    const games = Array.isArray(payload?.games) ? payload.games : [];
    const validGames = games
      .filter((g) => g && g.date && Number.isFinite(Number(g.disposals)))
      .filter((g) => {
        const rn = roundTextToNumber(g.round);
        return rn == null || rn >= 0; // include Round 0 onward
      })
      .map((g) => ({
        ...g,
        date: String(g.date).slice(0, 10),
        disposals: Number(g.disposals),
      }))
      .sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (da !== db) return da - db;
        return Number(a.game_number || 0) - Number(b.game_number || 0);
      });

    const prior = [];
    const playerSeasonAvg = Number(p.disposals);
    for (const g of validGames) {
      const key = `${playerName}|${g.date}|${g.round || ''}|${g.disposals}`;
      const actualDisposals = Number(g.disposals);
      const baseLine = buildPlayerLine(prior, playerSeasonAvg, `${key}|line`);
      const shouldWin = seededFloat(`${key}|target-result`) < TARGET_WIN_RATE;
      const { line, overUnder } = pickSideForTargetResult(actualDisposals, baseLine, shouldWin, key);
      const stake = pickStake(key);
      const bookmaker = BOOKMAKERS[Math.floor(seededFloat(`${key}|book`) * BOOKMAKERS.length) % BOOKMAKERS.length];
      const odds = ODDS_OPTIONS[Math.floor(seededFloat(`${key}|odds`) * ODDS_OPTIONS.length) % ODDS_OPTIONS.length];

      candidates.push(
        buildBetFromGame({
          userId,
          playerName,
          team,
          game: g,
          line,
          overUnder,
          bookmaker,
          odds,
          stake,
        })
      );
      prior.push(g.disposals);
    }
  }

  candidates.sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (da !== db) return da - db;
    return String(a.player_name).localeCompare(String(b.player_name));
  });

  const perDay = new Map();
  const finalBets = [];
  for (const bet of candidates) {
    if (maxPerDay > 0) {
      const key = bet.date;
      const current = perDay.get(key) || 0;
      if (current >= maxPerDay) continue;
      perDay.set(key, current + 1);
    }
    finalBets.push(bet);
    if (finalBets.length >= maxBets) break;
  }

  return finalBets;
}

function summarize(bets) {
  let running = 0;
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let totalStaked = 0;
  const stepRows = [];

  for (const b of bets) {
    totalStaked += Number(b.stake || 0);
    let pnl = 0;
    if (b.result === 'win') {
      wins += 1;
      pnl = b.stake * (b.odds - 1);
    } else if (b.result === 'loss') {
      losses += 1;
      pnl = -b.stake;
    } else {
      voids += 1;
    }
    running += pnl;
    stepRows.push({
      date: b.date,
      player: b.player_name,
      side: b.over_under,
      line: b.line,
      actual: b.actual_value,
      result: b.result,
      pnl: Number(pnl.toFixed(2)),
      running: Number(running.toFixed(2)),
      bookmaker: b.bookmaker,
    });
  }

  return {
    count: bets.length,
    wins,
    losses,
    voids,
    totalStaked: Number(totalStaked.toFixed(2)),
    avgStake: Number((totalStaked / (bets.length || 1)).toFixed(2)),
    net: Number(running.toFixed(2)),
    stepRows,
  };
}

async function insertBets(bets) {
  const chunkSize = 200;
  for (let i = 0; i < bets.length; i += chunkSize) {
    const chunk = bets.slice(i, i + chunkSize);
    const { error } = await supabase.from('bets').insert(chunk);
    if (error) throw new Error(`Insert failed at chunk ${i / chunkSize + 1}: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('AFL demo rebuild config:', args);
  console.log('');

  const user = await findUserByEmail(args.email);
  if (!user) {
    throw new Error(`User not found: ${args.email}`);
  }
  console.log(`Found user ${user.email} (${user.id})`);

  const { count: existingCount, error: countError } = await supabase
    .from('bets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if (countError) throw new Error(`Failed to count existing bets: ${countError.message}`);
  console.log(`Existing bets for user: ${existingCount ?? 0}`);

  const bets = await buildBetsFromApi({
    baseUrl: args.baseUrl,
    season: args.season,
    userId: user.id,
    maxPlayers: args.maxPlayers,
    maxBets: args.maxBets,
    maxPerDay: args.maxPerDay,
  });

  if (!bets.length) {
    throw new Error('No bets were generated from API data. Check base-url/season/data availability.');
  }

  const summary = summarize(bets);
  console.log(`Generated ${summary.count} AFL disposals single bets`);
  console.log(`Wins/Losses/Voids: ${summary.wins}/${summary.losses}/${summary.voids}`);
  console.log(`Total Staked: $${summary.totalStaked.toFixed(2)} AUD (avg $${summary.avgStake.toFixed(2)} per bet)`);
  console.log(`Net P/L: ${summary.net >= 0 ? '+' : ''}${summary.net.toFixed(2)} AUD`);
  console.log('');
  console.log('First 12 chart steps:');
  summary.stepRows.slice(0, 12).forEach((r, idx) => {
    console.log(
      `${String(idx + 1).padStart(2, '0')}. ${r.date} | ${r.player} ${r.side} ${r.line} (actual ${r.actual}) | ` +
      `${r.result.toUpperCase()} | P/L ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)} | Bank ${r.running >= 0 ? '+' : ''}${r.running.toFixed(2)} | ${r.bookmaker}`
    );
  });

  if (!args.apply) {
    console.log('');
    console.log('DRY RUN ONLY. No database changes were made.');
    console.log('Re-run with --apply to delete existing bets for this user and insert generated demo bets.');
    return;
  }

  console.log('');
  console.log('Applying changes...');

  const { error: deleteError } = await supabase.from('bets').delete().eq('user_id', user.id);
  if (deleteError) throw new Error(`Failed to delete existing bets: ${deleteError.message}`);
  console.log(`Deleted existing bets for ${args.email}`);

  await insertBets(bets);
  console.log(`Inserted ${bets.length} new AFL demo bets`);

  const { count: finalCount, error: finalCountError } = await supabase
    .from('bets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if (finalCountError) throw new Error(`Failed to verify inserted count: ${finalCountError.message}`);
  console.log(`Final bet count for user: ${finalCount ?? 0}`);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});

