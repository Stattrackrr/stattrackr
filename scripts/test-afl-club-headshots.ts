/**
 * Probe AFL club-site headshots (same logic as /api/afl/player-portraits club path).
 *
 * Usage:
 *   npm run test:afl:headshots
 *   npm run test:afl:headshots -- --api http://localhost:3000
 *
 * --api: also POST /api/afl/player-portraits (dev server must be running).
 */

import { fetchClubSitePortraitUrl } from '../lib/aflClubPlayerPortrait';

const SAMPLES: Array<{ name: string; team: string; homeTeam?: string; awayTeam?: string }> = [
  { name: 'Liam Duggan', team: 'West Coast Eagles' },
  { name: 'Luke Parker', team: 'North Melbourne Kangaroos' },
  { name: 'Nick Daicos', team: 'Collingwood Magpies' },
  { name: 'Marcus Bontempelli', team: 'Western Bulldogs' },
];

function isClubCdn(url: string | null): boolean {
  if (!url) return false;
  if (
    url.includes('photo-resources') &&
    (url.includes('resources.') || url.includes('.com.au'))
  ) {
    return true;
  }
  return url.includes('s.afl.com.au') && url.includes('ChampIDImages');
}

async function runDirect(): Promise<void> {
  console.log('--- Direct: fetchClubSitePortraitUrl (squad + profile scrape) ---\n');
  for (const row of SAMPLES) {
    const t0 = Date.now();
    const url = await fetchClubSitePortraitUrl(row.name, row.team);
    const ms = Date.now() - t0;
    const ok = isClubCdn(url);
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${row.name} | ${row.team}  (${ms}ms)`);
    console.log(`       ${url ?? 'null'}\n`);
  }
}

async function runApi(base: string): Promise<void> {
  const origin = base.replace(/\/$/, '');
  const url = `${origin}/api/afl/player-portraits`;
  console.log(`--- API: POST ${url} ---\n`);
  const players = SAMPLES.map((s) => ({
    name: s.name,
    team: s.team,
    homeTeam: s.homeTeam ?? s.team,
    awayTeam: s.awayTeam,
  }));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players }),
  });
  const text = await res.text();
  let json: { portraits?: Record<string, string | null>; error?: string };
  try {
    json = JSON.parse(text) as { portraits?: Record<string, string | null>; error?: string };
  } catch {
    console.error('Non-JSON response:', text.slice(0, 500));
    return;
  }
  if (!res.ok) {
    console.error('HTTP', res.status, json.error ?? text);
    return;
  }
  const portraits = json.portraits ?? {};
  for (const row of SAMPLES) {
    const u = portraits[row.name] ?? null;
    const ok = isClubCdn(u);
    const label = ok ? 'OK  ' : u == null ? 'NUM ' : 'FAIL';
    console.log(`${label}  ${row.name} | ${row.team}`);
    console.log(`       ${u ?? 'null'} (client falls back to jersey #)\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apiIdx = args.indexOf('--api');
  const apiBase = apiIdx >= 0 ? args[apiIdx + 1] ?? 'http://localhost:3000' : null;

  await runDirect();

  if (apiBase) {
    console.log('\n');
    await runApi(apiBase);
  } else {
    console.log('Tip: with dev server running, also run: npm run test:afl:headshots -- --api http://localhost:3000\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
