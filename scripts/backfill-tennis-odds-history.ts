/**
 * Archive API-Tennis's historical odds (one gzipped file per day) in the `tennis-history` storage bucket, kept
 * apart from the 90-day raw archive. Pinnacle's match-winner price is there back to about mid-2025; handicap and
 * total history only recently. Collection only: nothing here is read by the logger.
 *   npx tsx scripts/backfill-tennis-odds-history.ts [from YYYY-MM-DD] [to YYYY-MM-DD]
 * Days already archived are skipped, so it can be re-run.
 */
import { config } from 'dotenv';
import { gzipSync } from 'node:zlib';

config({ path: '.env.local' });

const BUCKET = 'tennis-history';
const DAY = 24 * 60 * 60_000;

async function main() {
  const { supabaseAdmin: db } = await import('@/lib/supabaseAdmin');
  const key = String(process.env.API_TENNIS_KEY || '').trim();
  if (!key) throw new Error('API_TENNIS_KEY missing');
  const from = process.argv[2] ?? '2025-05-01';
  const to = process.argv[3] ?? new Date(Date.now() - DAY).toISOString().slice(0, 10);

  await db.storage.createBucket(BUCKET, { public: false }).catch(() => undefined);
  const existing = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data } = await db.storage.from(BUCKET).list('apitennis-odds', { limit: 1000, offset });
    for (const f of data ?? []) existing.add(f.name);
    if (!data || data.length < 1000) break;
  }

  let saved = 0;
  let empty = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const name = `${date}.json.gz`;
    if (existing.has(name)) continue;
    const qs = new URLSearchParams({ method: 'get_odds', date_start: date, date_stop: date, APIkey: key });
    let json: any = null;
    for (let attempt = 1; attempt <= 3 && !json; attempt += 1) {
      json = await fetch(`https://api.api-tennis.com/tennis/?${qs}`, { signal: AbortSignal.timeout(60_000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!json) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    const result = json?.result ?? {};
    const n = Object.keys(result).length;
    if (!n) {
      empty += 1;
      continue;
    }
    const body = gzipSync(Buffer.from(JSON.stringify({ date, fetchedAt: new Date().toISOString(), result })));
    const { error } = await db.storage.from(BUCKET).upload(`apitennis-odds/${name}`, body, { contentType: 'application/gzip', upsert: false });
    if (error) console.log(`${date}: upload failed ${error.message}`);
    else {
      saved += 1;
      if (saved % 25 === 0) console.log(`${date}: ${saved} days saved`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`done: ${saved} days saved, ${empty} days with no odds, ${existing.size} already archived`);
  process.exit(0);
}

main();
