#!/usr/bin/env node
/**
 * Prediction Engine Data Source Checker
 * Verifies every piece of data used by the prediction engine is actually being fetched
 *
 * Run: node scripts/check-prediction-data-sources.mjs
 * Or:  node scripts/check-prediction-data-sources.mjs --player 237 --opponent BKN
 * Or:  node scripts/check-prediction-data-sources.mjs --player 237 --opponent BKN --date 2025-01-30
 *
 * For local API checks (DVP, Odds, Prediction), run `npm run dev` first.
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env.local for BDL key etc
try {
  require('dotenv').config({ path: join(__dirname, '..', '.env.local') });
} catch (_) {}

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const BDL_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';

const results = [];
function add(name, ok, detail, source = '') {
  results.push({ name, ok, detail, source });
  const icon = ok ? '✅' : '❌';
  const src = source ? ` [${source}]` : '';
  console.log(`  ${icon} ${name}${src}: ${detail}`);
}

async function fetchJson(url, options = {}) {
  const { timeout = 15000, ...fetchOpts } = options;
  const res = await fetch(url, { ...fetchOpts, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const playerId = args.find((a, i) => args[i - 1] === '--player') || args[0] || '237'; // LeBron default
  const opponent = args.find((a, i) => args[i - 1] === '--opponent') || args[1] || 'BKN';
  const dateArg = args.find((a, i) => args[i - 1] === '--date');
  const today = new Date().toISOString().split('T')[0];
  const gameDate = dateArg || today;
  const ymd = gameDate.replace(/-/g, '');

  console.log('\n🔍 PREDICTION ENGINE DATA SOURCE CHECK\n');
  console.log(`   Player ID: ${playerId} | Opponent: ${opponent} | Date: ${gameDate}${dateArg ? '' : ' (today)'}`);
  if (dateArg && dateArg.slice(0, 4) !== today.slice(0, 4)) {
    console.log(`   ⚠️  Note: --date is ${dateArg.slice(0, 4)} but current year is ${today.slice(0, 4)}. Omit --date to use today.`);
  }
  console.log(`   Base URL: ${BASE} (for local API checks, run: npm run dev)\n`);

  // ─── 1. BDL Player Stats ───
  console.log('1. BALLDONTLIE (Player Stats, Season, Game Logs)');
  try {
    if (!BDL_KEY) {
      add('BDL API Key', false, 'BALLDONTLIE_API_KEY not set', 'env');
    } else {
      const statsRes = await fetch(
        `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}&per_page=5`,
        { headers: { Authorization: BDL_KEY.startsWith('Bearer ') ? BDL_KEY : `Bearer ${BDL_KEY}` } }
      );
      const statsData = await statsRes.json();
      const hasStats = statsData?.data?.length > 0;
      add('BDL Player Stats', hasStats, hasStats ? `${statsData.data.length} games` : (statsData?.error || 'No data'), 'BDL API');
    }
  } catch (e) {
    add('BDL Player Stats', false, e.message, 'BDL API');
  }

  // ─── 2. BDL Injuries ───
  console.log('\n2. BALLDONTLIE (Injuries)');
  try {
    const injRes = await fetch(
      `https://api.balldontlie.io/v1/player_injuries?per_page=50`,
      { headers: BDL_KEY ? { Authorization: BDL_KEY.startsWith('Bearer ') ? BDL_KEY : `Bearer ${BDL_KEY}` } : {} }
    );
    const injData = await injRes.json();
    const injuries = injData?.data || [];
    add('BDL Injuries', injRes.ok, injuries.length > 0 ? `${injuries.length} injured players` : 'Empty (ok)', 'BDL API');
  } catch (e) {
    add('BDL Injuries', false, e.message, 'BDL API');
  }

  // ─── 3. ESPN Referee ───
  console.log('\n3. ESPN (Referee for Game)');
  try {
    const sbUrls = [
      `https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=${ymd}`,
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ymd}`,
    ];
    let sb = null;
    for (const u of sbUrls) {
      sb = await fetchJson(u);
      if (sb?.events?.length) break;
    }
    const events = sb?.events || [];
    const hasGames = events.length > 0;
    let refFound = false;
    let refDetail = 'No games today';
    const oppNorm = opponent.toUpperCase();
    const oppAliases = [oppNorm, oppNorm === 'BKN' ? 'BRK' : null, oppNorm === 'NOP' ? 'NO' : null].filter(Boolean);
    if (hasGames) {
      const evt = events.find((e) => {
        const comps = e?.competitions?.[0]?.competitors || [];
        const teams = comps.flatMap((c) => [
          (c?.team?.abbreviation || '').toUpperCase(),
          (c?.team?.shortDisplayName || '').toUpperCase(),
          (c?.team?.name || '').toUpperCase(),
        ]).filter(Boolean);
        return oppAliases.some((a) => teams.includes(a));
      });
      if (evt) {
        const officials = evt?.competitions?.[0]?.officials || [];
        refFound = officials.length > 0;
        refDetail = refFound ? officials.map((o) => o.displayName || o.name).filter(Boolean).join(', ') : 'No officials on scoreboard';
        if (!refFound && evt?.id) {
          const sum = await fetchJson(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/summary?event=${evt.id}`);
          const sumOfficials = sum?.gameInfo?.officials || sum?.officials || [];
          refFound = sumOfficials.length > 0;
          refDetail = refFound ? sumOfficials.map((o) => o.displayName || o.name).filter(Boolean).join(', ') : 'No officials in summary';
        }
      } else {
        refDetail = `No game found for ${opponent} on ${gameDate}`;
      }
    }
    add('ESPN Referee', refFound, refDetail, 'ESPN API');
  } catch (e) {
    add('ESPN Referee', false, e.message, 'ESPN API');
  }

  // ─── 4. ESPN Coach ───
  console.log('\n4. ESPN (Coach per Team)');
  try {
    const teamsRes = await fetchJson('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams');
    const teams = teamsRes?.sports?.[0]?.leagues?.[0]?.teams || [];
    const oppNorm = opponent.toUpperCase();
    const team = teams.find((t) => {
      const abbr = (t?.team?.abbreviation || '').toUpperCase();
      const short = (t?.team?.shortDisplayName || '').toUpperCase();
      return abbr === oppNorm || short === oppNorm || (oppNorm === 'BKN' && abbr === 'BRK') || (oppNorm === 'NOP' && (abbr === 'NO' || short === 'NO'));
    });
    if (team?.team?.id) {
      const urls = [
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.team.id}`,
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.team.id}?enable=roster`,
      ];
      let coachName = null;
      for (const url of urls) {
        const teamDetail = await fetchJson(url);
        const coach = teamDetail?.team?.coaches?.[0] || teamDetail?.coaches?.[0] || teamDetail?.team?.franchise?.coach;
        coachName = coach ? (coach.firstName && coach.lastName ? `${coach.firstName} ${coach.lastName}` : coach.displayName || coach.name || coach.fullName) : null;
        if (coachName) break;
      }
      add('ESPN Coach', !!coachName, coachName || 'Not in ESPN response', 'ESPN API');
    } else {
      add('ESPN Coach', false, `Team ${opponent} not found`, 'ESPN API');
    }
  } catch (e) {
    add('ESPN Coach', false, e.message, 'ESPN API');
  }

  // ─── 5. Static Arena ───
  console.log('\n5. STATIC (Arena / Altitude)');
  const NBA_ARENAS = {
    DEN: 5280, UTA: 4226, ATL: 1050, CHA: 760, PHX: 1090, OKC: 1200,
    CLE: 653, MEM: 337, SAS: 650, CHI: 597, MIL: 597, MIN: 830, IND: 715,
  };
  const arenaAlt = NBA_ARENAS[opponent.toUpperCase()];
  add('Static Arena', true, arenaAlt != null ? `${opponent} @ ${arenaAlt}ft` : `${opponent} (sea level)`, 'built-in');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ─── 6. Supabase (DB tables) ───
  console.log('\n6. SUPABASE (DB Tables)');
  if (!supabaseUrl || !supabaseKey) {
    add('Supabase Config', false, 'Missing SUPABASE url/key', 'env');
  } else {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const tables = [
      { name: 'coach_tendencies' },
      { name: 'arena_factors' },
      { name: 'referee_stats' },
      { name: 'player_contracts' },
      { name: 'player_former_teams' },
      { name: 'nba_api_cache' },
    ];
    for (const t of tables) {
      try {
        const { data, error } = await supabase.from(t.name).select('*').limit(1);
        if (error) {
          add(`Supabase ${t.name}`, false, error.message, 'Supabase');
        } else {
          const hasRows = data && data.length > 0;
          add(`Supabase ${t.name}`, true, hasRows ? `${data.length} row(s) sampled` : 'Table exists, empty', 'Supabase');
        }
      } catch (e) {
        add(`Supabase ${t.name}`, false, e.message, 'Supabase');
      }
    }
  }

  // ─── 7. NBA Cache (shot chart in nba_api_cache) ───
  console.log('\n7. NBA API CACHE (Shot Chart, Play Types in nba_api_cache)');
  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data: shotRows } = await supabase.from('nba_api_cache').select('cache_key').ilike('cache_key', 'shot_enhanced_%').limit(5);
      const hasShot = shotRows && shotRows.length > 0;
      add('NBA Cache Shot Chart', !!hasShot, hasShot ? `${shotRows.length}+ keys (shot_enhanced_*)` : 'No shot chart keys', 'nba_api_cache');
      const { data: ptRows } = await supabase.from('nba_api_cache').select('cache_key').ilike('cache_key', '%playtype%').limit(5);
      const hasPt = ptRows && ptRows.length > 0;
      add('NBA Cache Play Types', !!hasPt, hasPt ? `${ptRows.length}+ keys` : 'No play type keys', 'nba_api_cache');
    } catch (e) {
      add('NBA Cache', false, e.message, 'Supabase');
    }
  } else {
    add('NBA Cache', false, 'Supabase not configured', 'env');
  }

  // ─── 8. DVP / Opponent Stats ───
  console.log('\n8. OPPONENT / DVP DATA');
  try {
    const dvpRes = await fetchJson(`${BASE}/api/dvp?team=${opponent}&season=2025&metric=pts`);
    const hasDvp = dvpRes?.perGame && Object.keys(dvpRes.perGame).length > 0;
    add('DVP API', !!hasDvp, hasDvp ? 'Has perGame data' : (dvpRes?.error || 'No data'), 'local API');
  } catch (e) {
    add('DVP API', false, e.message || 'API unreachable', 'local');
  }

  // ─── 9. Odds Cache ───
  console.log('\n9. ODDS / GAME DATA');
  try {
    const cacheRes = await fetchJson(`${BASE}/api/debug/cache-get?key=all_nba_odds_v2_bdl`);
    const hasOdds = cacheRes?.exists && cacheRes?.ok;
    add('Odds Cache', !!hasOdds, hasOdds ? 'Has games' : (cacheRes?.ok ? 'Empty' : 'Miss'), 'shared/memory');
  } catch (e) {
    add('Odds Cache', false, e.message || 'API unreachable (dev server?)', 'local');
  }

  // ─── 10. Full Prediction Run ───
  console.log('\n10. FULL PREDICTION (End-to-End)');
  try {
    const predRes = await fetchJson(
      `${BASE}/api/prediction-engine?player_id=${playerId}&stat_type=pts&opponent=${opponent}&game_date=${gameDate}`,
      { timeout: 90000 }
    );
    const success = predRes?.success && predRes?.data?.[0];
    if (success) {
      const r = predRes.data[0];
      const models = r?.modelPredictions || [];
      const withRealData = models.filter((m) => {
        const reason = (m.reasoning || '').toLowerCase();
        return !reason.includes('not available') && !reason.includes('neutral (') && !reason.includes('baseline (') && !reason.includes('limited ');
      });
      const fallbacks = models.length - withRealData.length;
      add('Prediction API', true, `${models.length} models, ~${withRealData.length} with real data, ~${fallbacks} fallbacks`, 'local');
    } else {
      add('Prediction API', false, predRes?.error || 'No result', 'local');
    }
  } catch (e) {
    add('Prediction API', false, e.message || 'API unreachable (is dev server running?)', 'local');
  }

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '─'.repeat(50));
  console.log(`\n  📊 RESULT: ${passed}/${total} checks passed\n`);
  if (failed.length > 0) {
    console.log('  Failed checks:');
    failed.forEach((r) => console.log(`    - ${r.name}: ${r.detail}`));
    const hasSupabase = failed.some((r) => r.name.startsWith('Supabase'));
    const hasOdds = failed.some((r) => r.name.includes('Odds'));
    const hasRef = failed.some((r) => r.name.includes('Referee'));
    const hasCoach = failed.some((r) => r.name.includes('Coach'));
    console.log('');
    if (hasSupabase) {
      console.log('  💡 Fix Supabase tables: node scripts/apply-prediction-engine-tables.mjs');
      console.log('     Then run the SQL in Supabase Dashboard → SQL Editor\n');
    }
    if (hasOdds) {
      console.log('  💡 Fix Odds Cache: Trigger /api/odds/refresh (or run your odds cron)\n');
    }
    if (hasRef || hasCoach) {
      console.log('  💡 ESPN Referee/Coach: Default uses today\'s date. Omit --date to find current games.');
      console.log('     ESPN may not have officials in all game summaries.\n');
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
