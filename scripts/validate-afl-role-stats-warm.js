#!/usr/bin/env node

/**
 * After AFL player-logs warm, verify Role Stats fields (CBA / kick-ins) are present
 * in the prod cache for known mid + defender probes.
 *
 * Required: PROD_URL
 * Optional: AFL_ROLE_STATS_SEASON (default current year)
 */

const prodUrl = (process.env.PROD_URL || '').trim().replace(/\/+$/, '');
const season = Math.max(
  2017,
  parseInt(process.env.AFL_ROLE_STATS_SEASON || String(new Date().getFullYear()), 10)
);

const PROBES = [
  {
    name: 'Lachie Neale',
    team: 'Brisbane Lions',
    expect: 'cba',
  },
  {
    name: 'Darcy Wilmot',
    team: 'Brisbane Lions',
    expect: 'kick_ins',
  },
];

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/%/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function summarizeGames(games) {
  let cbaGames = 0;
  let cbaPctGames = 0;
  let cbaTeamGames = 0;
  let kickGames = 0;
  let kickTeamGames = 0;
  let maxCba = 0;
  let maxKick = 0;

  for (const g of games) {
    const cba = num(g?.cba);
    const cbaPct = num(g?.cba_pct);
    const cbaTeam = num(g?.cba_team);
    const kick = num(g?.kick_ins);
    const kickTeam = num(g?.kick_ins_team);

    if (cba != null) {
      cbaGames += 1;
      maxCba = Math.max(maxCba, cba);
    }
    if (cbaPct != null) cbaPctGames += 1;
    if (cbaTeam != null && cbaTeam > 0) cbaTeamGames += 1;
    if (kick != null) {
      kickGames += 1;
      maxKick = Math.max(maxKick, kick);
    }
    if (kickTeam != null && kickTeam > 0) kickTeamGames += 1;
  }

  return { cbaGames, cbaPctGames, cbaTeamGames, kickGames, kickTeamGames, maxCba, maxKick };
}

async function fetchLogs(playerName, team) {
  const params = new URLSearchParams({
    season: String(season),
    player_name: playerName,
    team,
    include_both: '1',
  });
  const url = `${prodUrl}/api/afl/player-game-logs?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const source = (
    res.headers.get('x-afl-player-logs-source') ||
    res.headers.get('X-AFL-Player-Logs-Source') ||
    ''
  ).toLowerCase();
  const json = await res.json().catch(() => ({}));
  const games = Array.isArray(json?.games) ? json.games : [];
  return { ok: res.ok, status: res.status, source, games, url };
}

async function main() {
  if (!prodUrl) {
    console.error('[Role Stats validate] Missing PROD_URL');
    process.exit(1);
  }

  console.log(`[Role Stats validate] Checking ${season} Role Stats fields on ${prodUrl}`);
  const failures = [];

  for (const probe of PROBES) {
    const { ok, status, source, games, url } = await fetchLogs(probe.name, probe.team);
    const summary = summarizeGames(games);
    console.log(
      `[Role Stats validate] ${probe.name}: HTTP ${status} source=${source || 'unknown'} games=${games.length}` +
        ` cba=${summary.cbaGames} cba%=${summary.cbaPctGames} cba_team=${summary.cbaTeamGames}` +
        ` kick_ins=${summary.kickGames} kick_ins_team=${summary.kickTeamGames}` +
        ` maxCba=${summary.maxCba} maxKick=${summary.maxKick}`
    );

    if (!ok || games.length === 0 || source === 'cache-miss') {
      failures.push(`${probe.name}: cache miss / empty (HTTP ${status}, source=${source || 'unknown'}) — ${url}`);
      continue;
    }

    if (probe.expect === 'cba') {
      if (summary.cbaGames === 0 || summary.maxCba <= 0) {
        failures.push(`${probe.name}: missing CBA values in warmed games`);
      }
      if (summary.cbaPctGames === 0) {
        failures.push(`${probe.name}: missing cba_pct in warmed games`);
      }
      // cba_team may be stored or derived client-side from cba_pct; require one of them.
      if (summary.cbaTeamGames === 0 && summary.cbaPctGames === 0) {
        failures.push(`${probe.name}: missing cba_team / cba_pct for CBA totals`);
      }
    }

    if (probe.expect === 'kick_ins') {
      if (summary.kickGames === 0 || summary.maxKick <= 0) {
        failures.push(`${probe.name}: missing kick_ins values in warmed games`);
      }
      if (summary.kickTeamGames === 0) {
        failures.push(
          `${probe.name}: missing kick_ins_team (player/team totals need a force-fetch on deployed Role Stats code)`
        );
      }
    }
  }

  // Light check that fantasy-tools role leaders endpoint is reachable via prod.
  try {
    const leadersUrl = `${prodUrl}/api/afl/role-leaders?team=Brisbane%20Lions&season=${season}&stat=cba&limit=3`;
    const res = await fetch(leadersUrl, { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    const leaders = Array.isArray(json?.leaders) ? json.leaders : [];
    console.log(
      `[Role Stats validate] role-leaders CBA: HTTP ${res.status} leaders=${leaders.length}` +
        (leaders[0] ? ` top=${leaders[0].player} (${leaders[0].total})` : '')
    );
    if (!res.ok || leaders.length === 0) {
      failures.push(`role-leaders CBA endpoint returned no leaders (HTTP ${res.status})`);
    }
  } catch (e) {
    failures.push(`role-leaders request failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (failures.length) {
    console.error('[Role Stats validate] ❌ Failed:');
    for (const f of failures) console.error(`   - ${f}`);
    console.error(
      '[Role Stats validate] Fix: deploy Role Stats mapping, then re-run AFL Process Stats (force-fetches 2026 player logs).'
    );
    process.exit(1);
  }

  console.log('[Role Stats validate] ✅ CBA / kick-ins Role Stats fields present in warmed cache');
}

main().catch((err) => {
  console.error('[Role Stats validate] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
