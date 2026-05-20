#!/usr/bin/env npx tsx

import { config } from 'dotenv';

config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  console.log('[probe] NEXT_PUBLIC_SUPABASE_URL:', url ? `${url.slice(0, 32)}…` : '(missing)');
  console.log('[probe] SUPABASE_SERVICE_ROLE_KEY:', key ? '(set)' : '(missing)');

  if (!url || !key) {
    console.log('[probe] Cannot query — Supabase env not configured.');
    return;
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { count: totalCount, error: countErr } = await supabase
    .from('soccer_api_cache')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.log('[probe] count error:', countErr.message);
    return;
  }
  console.log('[probe] soccer_api_cache total rows:', totalCount ?? 0);

  const { data: types, error: typesErr } = await supabase
    .from('soccer_api_cache')
    .select('cache_type')
    .limit(5000);

  if (typesErr) {
    console.log('[probe] types error:', typesErr.message);
    return;
  }

  const byType = new Map<string, number>();
  for (const row of types ?? []) {
    const t = String((row as { cache_type?: string }).cache_type || 'unknown');
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  console.log('[probe] cache_type counts (sample up to 5000 rows):');
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`);
  }

  const { data: playerRows, error: psErr } = await supabase
    .from('soccer_api_cache')
    .select('cache_key, team_href')
    .eq('cache_type', 'player_stats')
    .limit(10);

  if (psErr) {
    console.log('[probe] player_stats error:', psErr.message);
    return;
  }

  console.log('[probe] player_stats sample count:', playerRows?.length ?? 0);
  for (const row of playerRows ?? []) {
    console.log('  ', (row as { cache_key?: string }).cache_key);
  }

  const { count: psCount } = await supabase
    .from('soccer_api_cache')
    .select('*', { count: 'exact', head: true })
    .eq('cache_type', 'player_stats');

  console.log('[probe] player_stats total:', psCount ?? 0);

  const prefix = 'soccer:player-stats:v3:';
  const { count: v3Count } = await supabase
    .from('soccer_api_cache')
    .select('*', { count: 'exact', head: true })
    .eq('cache_type', 'player_stats')
    .like('cache_key', `${prefix}%`);

  console.log('[probe] player_stats with v3 prefix:', v3Count ?? 0);

  const { data: allPs } = await supabase
    .from('soccer_api_cache')
    .select('team_href, cache_key')
    .eq('cache_type', 'player_stats');

  const byTeam = new Map<string, number>();
  for (const row of allPs ?? []) {
    const key = String((row as { cache_key?: string }).cache_key || '');
    const href =
      String((row as { team_href?: string }).team_href || '').trim() ||
      key.match(/\/team\/[^/]+\/[^/]+/)?.[0] ||
      'unknown';
    byTeam.set(href, (byTeam.get(href) ?? 0) + 1);
  }
  console.log('[probe] player_stats by team:');
  for (const [href, n] of [...byTeam.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${href}`);
  }

  for (const cacheType of ['team_results', 'injuries', 'predicted_lineup'] as const) {
    const { count } = await supabase
      .from('soccer_api_cache')
      .select('*', { count: 'exact', head: true })
      .eq('cache_type', cacheType);
    const { data: rows } = await supabase
      .from('soccer_api_cache')
      .select('team_href')
      .eq('cache_type', cacheType)
      .not('team_href', 'is', null)
      .limit(2000);
    const teams = new Set(
      (rows ?? []).map((r) => String((r as { team_href?: string }).team_href || '').trim()).filter(Boolean)
    );
    console.log(`[probe] ${cacheType}: ${count ?? 0} rows, ${teams.size} distinct teams (sample)`);
  }
}

main().catch((e) => {
  console.error('[probe] failed', e);
  process.exitCode = 1;
});
