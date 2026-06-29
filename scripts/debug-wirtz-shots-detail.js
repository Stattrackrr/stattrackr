#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
for (const file of ['.env.local', '.env']) {
  const full = path.resolve(process.cwd(), file);
  if (fs.existsSync(full)) dotenv.config({ path: full, quiet: true });
}
const key = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
const base = 'https://api.balldontlie.io/fifa/worldcup/v1';

async function bdlFetchAll(endpoint, params = {}) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(base + endpoint);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else url.searchParams.set(k, String(v));
    }
    if (cursor != null) url.searchParams.set('cursor', String(cursor));
    url.searchParams.set('per_page', '100');
    const res = await fetch(url, { headers: { Authorization: key, Accept: 'application/json' } });
    const payload = await res.json();
    rows.push(...(payload.data || []));
    cursor = payload.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  return rows;
}

async function main() {
  const pid = 29945;
  const teamId = 17;
  const [stats, matches] = await Promise.all([
    bdlFetchAll('/player_match_stats', { 'player_ids[]': String(pid), 'seasons[]': '2026' }),
    bdlFetchAll('/matches', { 'seasons[]': '2026' }),
  ]);
  const teamMatches = matches
    .filter((m) => m.status === 'completed' && (m.home_team?.id === teamId || m.away_team?.id === teamId))
    .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
  const mids = teamMatches.map((m) => m.id);
  const allShots = [];
  for (let i = 0; i < mids.length; i += 50) {
    const chunk = mids.slice(i, i + 50);
    const params = { 'match_ids[]': chunk.map(String) };
    const shots = await bdlFetchAll('/match_shots', params);
    allShots.push(...shots.filter((s) => Number(s.player_id) === pid));
  }

  console.log('player_match_stats:');
  for (const row of stats.sort((a, b) => a.match_id - b.match_id)) {
    const m = teamMatches.find((x) => x.id === row.match_id);
    console.log({
      match_id: row.match_id,
      date: m?.datetime?.slice(0, 10),
      minutes: row.minutes_played,
      shots_total: row.shots_total,
      shots_on_target: row.shots_on_target,
    });
  }

  console.log('\nmatch_shots by game:');
  for (const m of teamMatches) {
    const shots = allShots.filter((s) => Number(s.match_id) === m.id);
    const opp = m.home_team.id === teamId ? m.away_team.name : m.home_team.name;
    const onTarget = shots.filter((s) => s.on_target === true).length;
    console.log({
      match_id: m.id,
      date: m.datetime?.slice(0, 10),
      opp,
      total: shots.length,
      on_target: onTarget,
      shots: shots.map((s) => ({
        type: s.shot_type,
        on_target: s.on_target,
        result: s.result,
        xgot: s.xgot,
      })),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
