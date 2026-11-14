/**
 * Backfill nba_players.nba_person_id for active rostered players missing it.
 * Uses stats.nba.com commonallplayers (all players) + nickname / word-order aliases.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/_backfill-nba-person-ids.ts [--write]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const WRITE = process.argv.includes('--write');
const SEASON = '2025-26';

const NBA_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nba.com/stats/',
  Origin: 'https://www.nba.com',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

/** BDL / book legal names → NBA DISPLAY_FIRST_LAST (normalized keys). */
const NAME_ALIASES: Record<string, string> = {
  'airious bailey': 'ace bailey',
  'carlton carrington': 'bub carrington',
  'nah shon hyland': 'bones hyland',
  'nashion hyland': 'bones hyland',
  'ron holland': 'ronald holland ii',
  'ron holland ii': 'ronald holland ii',
  'hansen yang': 'yang hansen',
  'nic claxton': 'nicolas claxton',
  'alex sarr': 'alexandre sarr',
  'cam thomas': 'cameron thomas',
  'herb jones': 'herbert jones',
};

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type NbaRow = { id: number; name: string; key: string; roster: number; toYear: number };

async function fetchNbaPlayers(): Promise<NbaRow[]> {
  const params = new URLSearchParams({
    LeagueID: '00',
    Season: SEASON,
    IsOnlyCurrentSeason: '0',
  });
  const res = await fetch(`https://stats.nba.com/stats/commonallplayers?${params}`, { headers: NBA_HEADERS });
  if (!res.ok) throw new Error(`NBA commonallplayers ${res.status}`);
  const data = await res.json();
  const rs = data?.resultSets?.[0];
  const headers: string[] = rs?.headers ?? [];
  const rows: unknown[][] = rs?.rowSet ?? [];
  const personIdx = headers.indexOf('PERSON_ID');
  const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
  const rosterIdx = headers.indexOf('ROSTERSTATUS');
  const toYearIdx = headers.indexOf('TO_YEAR');
  return rows.map((row) => {
    const name = String(row[nameIdx] ?? '');
    return {
      id: Number(row[personIdx]),
      name,
      key: norm(name),
      roster: Number(row[rosterIdx] ?? 0),
      toYear: Number(row[toYearIdx] ?? 0),
    };
  });
}

function candidateKeys(wantName: string): string[] {
  const raw = norm(wantName);
  const out = new Set<string>([raw]);
  if (NAME_ALIASES[raw]) out.add(norm(NAME_ALIASES[raw]));
  const parts = raw.split(' ').filter(Boolean);
  if (parts.length === 2) out.add(`${parts[1]} ${parts[0]}`);
  // drop middle names → first + last
  if (parts.length > 2) out.add(`${parts[0]} ${parts[parts.length - 1]}`);
  return [...out];
}

function pickBest(hits: NbaRow[]): NbaRow | null {
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0]!;
  const rostered = hits.filter((h) => h.roster === 1);
  if (rostered.length === 1) return rostered[0]!;
  const recent = [...hits].sort((a, b) => b.toYear - a.toYear || b.roster - a.roster);
  // only accept if top is uniquely best by toYear
  if (recent.length >= 2 && recent[0]!.toYear > recent[1]!.toYear) return recent[0]!;
  if (rostered.length > 1) return null;
  return recent[0] ?? null;
}

function matchNba(wantName: string, byKey: Map<string, NbaRow[]>): NbaRow | null {
  for (const key of candidateKeys(wantName)) {
    const exact = pickBest(byKey.get(key) ?? []);
    if (exact) return exact;
  }
  // last name + first initial / prefix (unique)
  for (const key of candidateKeys(wantName)) {
    const parts = key.split(' ');
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1]!;
    const first = parts[0]!;
    const pool: NbaRow[] = [];
    for (const [k, rows] of byKey) {
      const pp = k.split(' ');
      if (pp[pp.length - 1] !== last) continue;
      const f = pp[0] ?? '';
      if (f === first || f.startsWith(first) || first.startsWith(f)) pool.push(...rows);
    }
    const best = pickBest(pool);
    if (best) return best;
  }
  return null;
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { PLAYER_ID_MAPPINGS } = await import('@/lib/playerIdMapping');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('Fetching NBA commonallplayers…');
  const nba = await fetchNbaPlayers();
  console.log('NBA players:', nba.length);
  const byKey = new Map<string, NbaRow[]>();
  for (const p of nba) {
    byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  }

  const players: Array<{ id: number; full_name: string; nba_person_id: number | null }> = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('nba_players')
      .select('id, full_name, nba_person_id')
      .eq('is_active', true)
      .not('team_id', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    players.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('Active rostered players:', players.length);

  const mappedByBdl = new Map(PLAYER_ID_MAPPINGS.map((m) => [String(m.bdlId), m]));
  const missing = players.filter((p) => p.nba_person_id == null);
  console.log('Missing nba_person_id:', missing.length);

  const updates: Array<{ id: number; full_name: string; nbaId: number; nbaName: string }> = [];
  const unresolved: string[] = [];
  for (const p of missing) {
    const hit = matchNba(p.full_name, byKey);
    if (!hit) {
      unresolved.push(`${p.full_name} (${p.id})`);
      continue;
    }
    updates.push({ id: p.id, full_name: p.full_name, nbaId: hit.id, nbaName: hit.name });
  }

  console.log('\nResolved:', updates.length);
  for (const u of updates) {
    console.log(`  ${u.full_name} → ${u.nbaName} (${u.nbaId})`);
  }
  if (unresolved.length) {
    console.log('\nUnresolved:', unresolved.length);
    for (const u of unresolved) console.log('  ', u);
  }

  console.log('\nCDN headshot check (resolved with props-relevant names)…');
  const spotlight = updates.filter((u) =>
    /bailey|carrington|yang|boozer|dybantsa|hyland|bamba|bufkin|flagg|harper/i.test(u.full_name)
  );
  for (const u of [...spotlight, ...updates.slice(0, 10)].slice(0, 20)) {
    const url = `https://cdn.nba.com/headshots/nba/latest/1040x760/${u.nbaId}.png`;
    const res = await fetch(url, { method: 'HEAD' });
    console.log(`  ${u.full_name} ${u.nbaId} → ${res.status} cl=${res.headers.get('content-length')}`);
  }

  if (WRITE && updates.length) {
    console.log('\nWriting nba_person_id…');
    let ok = 0;
    for (const u of updates) {
      const { error } = await db.from('nba_players').update({ nba_person_id: u.nbaId }).eq('id', u.id);
      if (error) console.error('  fail', u.full_name, error.message);
      else ok += 1;
    }
    console.log(`Updated ${ok}/${updates.length}`);
  } else if (!WRITE) {
    console.log('\nDry run. Pass --write to update DB.');
  }

  const needMap = [
    ...updates.map((u) => ({ bdlId: String(u.id), nbaId: String(u.nbaId), name: u.full_name })),
    ...players
      .filter((p) => p.nba_person_id != null && !mappedByBdl.has(String(p.id)))
      .map((p) => ({ bdlId: String(p.id), nbaId: String(p.nba_person_id), name: p.full_name })),
  ];
  console.log('\n--- mapping stubs (missing from PLAYER_ID_MAPPINGS) ---');
  const seen = new Set<string>();
  for (const s of needMap) {
    if (mappedByBdl.has(s.bdlId) || seen.has(s.bdlId)) continue;
    seen.add(s.bdlId);
    console.log(`  { bdlId: '${s.bdlId}', nbaId: '${s.nbaId}', name: '${s.name.replace(/'/g, "\\'")}' },`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
