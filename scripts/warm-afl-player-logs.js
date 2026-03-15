#!/usr/bin/env node

/**
 * Warm AFL player-game-logs cache by calling production API for active players.
 *
 * Required:
 *   PROD_URL=https://your-app.vercel.app
 *
 * Optional:
 *   AFL_WARM_SEASONS=2026,2025
 *   AFL_WARM_CONCURRENCY=6
 *   AFL_WARM_LIMIT=0 (0 = no limit)
 *   AFL_WARM_MAX_FAILURES=100 (workflow succeeds if failed count < this; default 100)
 *   AFL_WARM_PLAYER=Nasiah  (only warm players whose name contains this string, case-insensitive)
 *   CRON_SECRET=... (sent as Bearer + X-Cron-Secret)
 */

const fs = require('fs');
const path = require('path');

const prodUrl = (process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
// Only warm current season (2026); 2025 is cached forever and never re-fetched
const warmSeasons = String(process.env.AFL_WARM_SEASONS || '2026')
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((n) => Number.isFinite(n));
const concurrency = Math.max(1, parseInt(process.env.AFL_WARM_CONCURRENCY || '6', 10));
const warmLimit = Math.max(0, parseInt(process.env.AFL_WARM_LIMIT || '0', 10));
const maxFailures = Math.max(0, parseInt(process.env.AFL_WARM_MAX_FAILURES || '100', 10));
const warmPlayerFilter = (process.env.AFL_WARM_PLAYER || '').trim().toLowerCase();
const cronSecret = (process.env.CRON_SECRET || '').trim();

if (!prodUrl) {
  console.error('Missing PROD_URL');
  process.exit(1);
}

function loadActiveAflPlayers() {
  const dataDir = path.join(process.cwd(), 'data');
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => /^afl-league-player-stats-\d+\.json$/i.test(f))
    .sort()
    .reverse();

  for (const file of files) {
    try {
      const fullPath = path.join(dataDir, file);
      const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const players = Array.isArray(json?.players) ? json.players : [];
      if (!players.length) continue;
      return players
        .map((p) => ({
          name: String(p?.name || '').trim(),
          team: String(p?.team || '').trim(),
          games: Number(p?.games || 0),
        }))
        .filter((p) => p.name && p.team && p.games > 0);
    } catch {
      // Try older snapshot.
    }
  }

  return [];
}

// Same team normalization as API (footywireNicknameToOfficial) so we hit the same cache keys the frontend uses.
const NICKNAME_TO_FULL = {
  Crows: 'Adelaide Crows', Lions: 'Brisbane Lions', Blues: 'Carlton Blues', Magpies: 'Collingwood Magpies',
  Bombers: 'Essendon Bombers', Dockers: 'Fremantle Dockers', Cats: 'Geelong Cats', Suns: 'Gold Coast Suns',
  Giants: 'GWS Giants', Hawks: 'Hawthorn Hawks', Demons: 'Melbourne Demons', Kangaroos: 'North Melbourne Kangaroos',
  Power: 'Port Adelaide Power', Tigers: 'Richmond Tigers', Saints: 'St Kilda Saints', Swans: 'Sydney Swans',
  Eagles: 'West Coast Eagles', Bulldogs: 'Western Bulldogs',
};

function teamForRequest(team) {
  const t = String(team || '').trim();
  return NICKNAME_TO_FULL[t] || NICKNAME_TO_FULL[t.replace(/\s+/g, ' ')] || t;
}

const WARM_REQUEST_TIMEOUT_MS = 45000; // 45s per request so slow/hanging requests don't block the run

async function warmOne(player, season) {
  const team = teamForRequest(player.team);
  const params = new URLSearchParams({
    season: String(season),
    player_name: player.name,
    team,
    include_both: '1',
    force_fetch: '1',
  });

  const headers = { Accept: 'application/json' };
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
    headers['X-Cron-Secret'] = cronSecret;
  }

  const url = `${prodUrl}/api/afl/player-game-logs?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WARM_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, body };
    }
    const json = await res.json().catch(() => ({}));
    const count = Number(json?.game_count || (Array.isArray(json?.games) ? json.games.length : 0));
    return { ok: true, count };
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err?.name === 'AbortError';
    return { ok: false, status: isAbort ? 408 : 0, body: isAbort ? 'timeout' : String(err?.message || err) };
  }
}

async function runPool(jobs, worker, size) {
  let index = 0;
  let active = 0;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const next = async () => {
    while (active < size && index < jobs.length) {
      const current = jobs[index++];
      active += 1;
      Promise.resolve(worker(current))
        .catch(() => undefined)
        .finally(() => {
          active -= 1;
          if (index >= jobs.length && active === 0) resolveDone();
          else next();
        });
    }
  };

  next();
  await done;
}

async function main() {
  let players = loadActiveAflPlayers();
  if (warmPlayerFilter) {
    players = players.filter((p) => p.name.toLowerCase().includes(warmPlayerFilter));
    console.log(`[AFL Warm] 🎯 Filter: only players matching "${process.env.AFL_WARM_PLAYER}" → ${players.length} player(s)`);
  }
  const selectedPlayers = warmLimit > 0 ? players.slice(0, warmLimit) : players;
  if (!selectedPlayers.length) {
    console.log('No active AFL players found to warm.');
    return;
  }

  const jobs = [];
  for (const season of warmSeasons) {
    for (const player of selectedPlayers) {
      jobs.push({ player, season });
    }
  }

  console.log(`[AFL Warm] 🔥 Warming AFL player logs cache (include_both=1, same path as frontend)`);
  console.log(`[AFL Warm] 👥 Players: ${selectedPlayers.length}`);
  console.log(`[AFL Warm] 📅 Seasons: ${warmSeasons.join(', ')}`);
  console.log(`[AFL Warm] 📤 Requests: ${jobs.length}`);
  console.log(`[AFL Warm] ⚡ Concurrency: ${concurrency}`);
  const sample = selectedPlayers.slice(0, 10).map((p) => `${p.name} (${teamForRequest(p.team)})`);
  console.log(`[AFL Warm] 🎯 Sample: ${sample.join(', ')}${selectedPlayers.length > 10 ? '...' : ''}`);

  let success = 0;
  let failed = 0;
  let noData = 0;
  let warmedGames = 0;
  let done = 0;
  const failedPlayers = [];
  const noDataPlayers = [];
  const progressInterval = Math.max(1, Math.floor(jobs.length / 20)); // ~20 progress lines

  await runPool(
    jobs,
    async (job) => {
      const result = await warmOne(job.player, job.season);
      if (result.ok) {
        success += 1;
        warmedGames += Number(result.count || 0);
        if (Number(result.count || 0) === 0) {
          noData += 1;
          noDataPlayers.push(`${job.player.name} (${teamForRequest(job.player.team)}) ${job.season}`);
        }
      } else {
        failed += 1;
        failedPlayers.push(`${job.player.name} (${job.player.team}) ${job.season} — HTTP ${result.status || 'error'}`);
      }
      done += 1;
      if (done % progressInterval === 0 || done === jobs.length) {
        console.log(`[AFL Warm] 📊 ${done}/${jobs.length} — last: ${job.player.name} (${teamForRequest(job.player.team)}) ${job.season} — ${result.ok ? `✅ ${result.count ?? 0} games` : `❌ ${result.status}`}`);
      }
    },
    concurrency
  );

  console.log(`[AFL Warm] ✅ Warm complete. success=${success} failed=${failed} noData=${noData} warmedGames=${warmedGames}`);
  if (failedPlayers.length > 0) {
    console.log(`[AFL Warm] ❌ Failed requests (${failedPlayers.length}):`);
    failedPlayers.forEach((key) => console.log(`   ${key}`));
  }
  if (noDataPlayers.length > 0) {
    console.log(`[AFL Warm] ⚠️ No data / 0 games (${noDataPlayers.length}):`);
    noDataPlayers.forEach((key) => console.log(`   ${key}`));
  }

  // Cache health check: GET without cron secret (same as a user). Fail workflow if we warmed but prod returns cache-miss.
  let cacheHealthOk = false;
  let ranCacheHealthCheck = false;
  if (selectedPlayers.length > 0 && success > 0) {
    ranCacheHealthCheck = true;
    const probe = selectedPlayers[0];
    const team = teamForRequest(probe.team);
    const verifySeason = warmSeasons.includes(2025) ? 2025 : warmSeasons[0];
    const verifyUrl = `${prodUrl}/api/afl/player-game-logs?season=${verifySeason}&player_name=${encodeURIComponent(probe.name)}&team=${encodeURIComponent(team)}&include_both=1`;
    console.log(`[AFL Warm] 🔍 Cache health check: GET (no cron secret) ${verifyUrl}`);
    try {
      const res = await fetch(verifyUrl, { headers: { Accept: 'application/json' } });
      const source = (res.headers.get('x-afl-player-logs-source') || res.headers.get('X-AFL-Player-Logs-Source') || '').toLowerCase();
      const cacheEnabled = (res.headers.get('x-afl-cache-enabled') || res.headers.get('X-AFL-Cache-Enabled') || '').toLowerCase();
      const keyBase = res.headers.get('x-afl-cache-key-base') || res.headers.get('X-AFL-Cache-Key-Base') || '';
      const key2025 = res.headers.get('x-afl-cache-key-2025-fallback') || res.headers.get('X-AFL-Cache-Key-2025-Fallback') || '';
      const json = await res.json().catch(() => ({}));
      const gameCount = Number(json?.game_count ?? (Array.isArray(json?.games) ? json.games.length : 0));

      if (source === 'cache' && gameCount > 0) {
        console.log(`[AFL Warm] ✅ Cache health OK: ${probe.name} (${verifySeason}) → HTTP ${res.status}, cache hit, ${gameCount} games`);
        cacheHealthOk = true;
      } else {
        console.log(`[AFL Warm] ❌ Cache health FAIL: ${probe.name} (${verifySeason}) → HTTP ${res.status}, source=${source || 'unknown'}, games=${gameCount}`);
        console.log(`[AFL Warm]    X-AFL-Cache-Enabled: ${cacheEnabled || '(missing)'}`);
        if (keyBase) console.log(`[AFL Warm]    X-AFL-Cache-Key-Base: ${keyBase}`);
        if (key2025) console.log(`[AFL Warm]    X-AFL-Cache-Key-2025-Fallback: ${key2025}`);
        console.log(`[AFL Warm]    Fix: ensure PROD_URL deployment has same UPSTASH_REDIS_REST_URL/TOKEN as Upstash; AFL_USE_UPSTASH_CACHE=true; re-run warm.`);
      }
    } catch (e) {
      console.log(`[AFL Warm] ❌ Cache health request failed:`, e instanceof Error ? e.message : String(e));
    }
  }

  if (ranCacheHealthCheck && !cacheHealthOk) {
    console.error(`[AFL Warm] Cache health check failed (prod returned cache-miss after warm). Workflow failing.`);
    process.exitCode = 1;
  }

  if (failed >= maxFailures) {
    console.error(`Failed count (${failed}) >= AFL_WARM_MAX_FAILURES (${maxFailures}); exiting with error.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Warm failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

