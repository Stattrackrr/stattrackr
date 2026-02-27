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
 *   CRON_SECRET=... (sent as Bearer + X-Cron-Secret)
 */

const fs = require('fs');
const path = require('path');

const prodUrl = (process.env.PROD_URL || '').trim().replace(/\/+$/, '');
const warmSeasons = String(process.env.AFL_WARM_SEASONS || '2026,2025')
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((n) => Number.isFinite(n));
const concurrency = Math.max(1, parseInt(process.env.AFL_WARM_CONCURRENCY || '6', 10));
const warmLimit = Math.max(0, parseInt(process.env.AFL_WARM_LIMIT || '0', 10));
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

async function warmOne(player, season, includeQuarters) {
  const params = new URLSearchParams({
    season: String(season),
    player_name: player.name,
    team: player.team,
  });
  if (includeQuarters) params.set('include_quarters', '1');

  const headers = { Accept: 'application/json' };
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
    headers['X-Cron-Secret'] = cronSecret;
  }

  const url = `${prodUrl}/api/afl/player-game-logs?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body };
  }
  const json = await res.json().catch(() => ({}));
  const count = Number(json?.game_count || (Array.isArray(json?.games) ? json.games.length : 0));
  return { ok: true, count };
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
  const players = loadActiveAflPlayers();
  const selectedPlayers = warmLimit > 0 ? players.slice(0, warmLimit) : players;
  if (!selectedPlayers.length) {
    console.log('No active AFL players found to warm.');
    return;
  }

  const jobs = [];
  for (const season of warmSeasons) {
    for (const player of selectedPlayers) {
      jobs.push({ player, season, includeQuarters: false });
      jobs.push({ player, season, includeQuarters: true });
    }
  }

  console.log(`Warming AFL player logs cache`);
  console.log(`Players: ${selectedPlayers.length}`);
  console.log(`Seasons: ${warmSeasons.join(', ')}`);
  console.log(`Requests: ${jobs.length}`);
  console.log(`Concurrency: ${concurrency}`);

  let success = 0;
  let failed = 0;
  let warmedGames = 0;

  await runPool(
    jobs,
    async (job) => {
      const result = await warmOne(job.player, job.season, job.includeQuarters);
      if (result.ok) {
        success += 1;
        warmedGames += Number(result.count || 0);
      } else {
        failed += 1;
      }
    },
    concurrency
  );

  console.log(`Warm complete. success=${success} failed=${failed} warmedGames=${warmedGames}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Warm failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

