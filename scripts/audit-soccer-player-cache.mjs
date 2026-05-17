/**
 * Lists soccer player_stats cache keys and category coverage for one player.
 * Usage: node scripts/audit-soccer-player-cache.mjs [playerKey]
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

const PLAYER_KEY = (process.argv[2] || 'haaland-erling').trim().toLowerCase();
const TEAM_HREF = '/team/manchester-city/Wtn9Stg0';
const PREFIX = `soccer:player-stats:v3:${TEAM_HREF}:${PLAYER_KEY}:`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing Supabase env in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function countCategoriesInMatches(matches) {
  const catCounts = new Map();
  let totalMatches = 0;
  for (const m of matches) {
    if (!m || typeof m !== 'object') continue;
    totalMatches += 1;
    const cats = m.categories && typeof m.categories === 'object' ? Object.keys(m.categories) : [];
    const n = cats.length;
    catCounts.set(n, (catCounts.get(n) || 0) + 1);
  }
  return { totalMatches, catCounts };
}

function sampleCategoryKeys(matches, max = 1) {
  const out = [];
  for (const m of matches.slice(0, max)) {
    out.push(m?.categories ? Object.keys(m.categories).sort() : []);
  }
  return out;
}

const { data, error } = await supabase
  .from('soccer_api_cache')
  .select('cache_key, fetched_at, expires_at, data')
  .eq('cache_type', 'player_stats')
  .like('cache_key', `${PREFIX}%`);

if (error) {
  console.error(error);
  process.exit(1);
}

const rows = Array.isArray(data) ? data : [];
console.log(`Player: ${PLAYER_KEY}`);
console.log(`Rows matching ${PREFIX}* : ${rows.length}\n`);

if (!rows.length) {
  console.log('No cache rows for this player. Batch may not have written or used a different playerKey.');
  process.exit(0);
}

for (const row of rows.sort((a, b) => String(a.cache_key).localeCompare(String(b.cache_key)))) {
  const payload = row.data;
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  const { totalMatches, catCounts } = countCategoriesInMatches(matches);
  const storedCats = Array.isArray(payload?.categories) ? payload.categories.join(',') : '?';
  const samples = sampleCategoryKeys(matches, 2);
  console.log('---');
  console.log('cache_key:', row.cache_key);
  console.log('fetched_at:', row.fetched_at, ' expires_at:', row.expires_at);
  console.log('payload.categories:', storedCats);
  console.log('matches:', totalMatches);
  console.log('categories per match (count -> #matches):', Object.fromEntries([...catCounts.entries()].sort((a, b) => a[0] - b[0])));
  console.log('sample match category tabs:', JSON.stringify(samples));
}
