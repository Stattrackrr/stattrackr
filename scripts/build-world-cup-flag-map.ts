#!/usr/bin/env npx tsx
/**
 * Build a verified flag map for every team that can appear in the World Cup
 * dashboard chart.
 *
 * Gathers every distinct team from:
 *   - BDL FIFA World Cup `/teams` (all seasons) — name + country_code
 *   - Supabase `international_teams` (Euros / Nations League / Copa / AFCON)
 *
 * For each team it generates ordered candidate ESPN flag slugs (from country
 * code via ISO maps, from the country name, ISO-3 identity, …), then VALIDATES
 * each candidate against the live ESPN country-logo CDN and keeps the first one
 * that returns a real image. The result is written to
 * `data/world-cup-flag-map.json`, which lib/worldCupFlags.ts consults at runtime.
 *
 * Any team that cannot be resolved is printed so the built-in maps in
 * lib/worldCupFlags.ts can be extended.
 *
 * Usage:
 *   npm run build:world-cup:flag-map
 *   npx tsx scripts/build-world-cup-flag-map.ts
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

const ENV_FILES = ['.env.local', '.env.development.local', '.env'];
for (const file of ENV_FILES) {
  const fullPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(fullPath)) config({ path: fullPath, override: false });
}

const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
const ESPN_FLAG = (slug: string) =>
  `https://a.espncdn.com/combiner/i?img=/i/teamlogos/countries/500/${slug}.png&h=80&w=80`;
const ALL_WORLD_CUP_SEASONS = ['2018', '2022', '2026'];
const OUTPUT_PATH = path.resolve(process.cwd(), 'data/world-cup-flag-map.json');

type TeamEntry = { name: string; code: string | null };

function log(msg: string) {
  console.log(`[flag-map] ${msg}`);
}

function normalizeName(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchBdlTeams(): Promise<TeamEntry[]> {
  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!apiKey) {
    log('No BALLDONTLIE_API_KEY set — skipping BDL teams.');
    return [];
  }
  const auth = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  const url = new URL(`${BDL_FIFA_BASE}/teams`);
  ALL_WORLD_CUP_SEASONS.forEach((s) => url.searchParams.append('seasons[]', s));
  url.searchParams.set('per_page', '100');

  const out: TeamEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const pageUrl = new URL(url.toString());
    if (cursor) pageUrl.searchParams.set('cursor', cursor);
    const res = await fetch(pageUrl.toString(), {
      headers: { Accept: 'application/json', Authorization: auth, 'User-Agent': 'StatTrackr/1.0' },
    });
    if (!res.ok) {
      log(`BDL /teams failed (${res.status}); continuing with what we have.`);
      break;
    }
    const payload = (await res.json()) as {
      data?: Array<{ name?: string; country_code?: string | null; abbreviation?: string | null }>;
      meta?: { next_cursor?: string | null };
    };
    for (const t of payload.data ?? []) {
      out.push({ name: String(t.name ?? '').trim(), code: (t.country_code || t.abbreviation || null) as string | null });
    }
    cursor = payload.meta?.next_cursor ? String(payload.meta.next_cursor) : null;
    if (!cursor) break;
  }
  log(`fetched ${out.length} BDL World Cup teams`);
  return out;
}

async function fetchInternationalTeams(): Promise<TeamEntry[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    log('No Supabase env — skipping international teams.');
    return [];
  }
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const out: TeamEntry[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 100000; from += pageSize) {
    const { data, error } = await db
      .from('international_teams')
      .select('team_name, country_code')
      .range(from, from + pageSize - 1);
    if (error) {
      log(`international_teams read failed: ${error.message}`);
      break;
    }
    const rows = (data ?? []) as Array<{ team_name: string | null; country_code: string | null }>;
    for (const r of rows) out.push({ name: String(r.team_name ?? '').trim(), code: r.country_code });
    if (rows.length < pageSize) break;
  }
  log(`fetched ${out.length} international team rows`);
  return out;
}

function candidateSlugs(entry: TeamEntry): string[] {
  const candidates: string[] = [];
  const push = (v?: string | null) => {
    const s = String(v || '').trim().toLowerCase();
    if (s && /^[a-z]{2,3}$/.test(s) && !candidates.includes(s)) candidates.push(s);
  };

  const code = String(entry.code || '').trim().toLowerCase();
  const nameKey = normalizeName(entry.name);

  // Resolve through the shared maps first (most reliable).
  const fromShared = FLAG_RESOLVE(entry.code) || FLAG_RESOLVE(entry.name);
  if (fromShared) push(fromShared);

  // Raw code variants.
  if (code.length === 3) push(code); // many FIFA codes equal ISO-3
  if (code.length === 2) push(FIFA_ISO2[code]);

  // Name-based.
  if (FIFA_NAME[nameKey]) push(FIFA_NAME[nameKey]);

  return candidates;
}

// Lazy holders populated from the shared module after import.
let FLAG_RESOLVE: (input?: string | null) => string | null = () => null;
let FIFA_ISO2: Record<string, string> = {};
let FIFA_NAME: Record<string, string> = {};

const validationCache = new Map<string, boolean>();
async function slugIsValid(slug: string): Promise<boolean> {
  if (validationCache.has(slug)) return validationCache.get(slug)!;
  let ok = false;
  try {
    const res = await fetch(ESPN_FLAG(slug), { method: 'HEAD', headers: { 'User-Agent': 'StatTrackr/1.0' } });
    const type = res.headers.get('content-type') || '';
    // ESPN serves a real PNG (200, image/*) for known FIFA codes and 404s unknown
    // ones, so status + content-type is a reliable existence check.
    ok = res.ok && type.startsWith('image');
  } catch {
    ok = false;
  }
  validationCache.set(slug, ok);
  return ok;
}

async function main() {
  const shared = await import('../lib/worldCupFlags');
  FLAG_RESOLVE = shared.resolveWorldCupFlagCode;
  FIFA_ISO2 = shared.FIFA_ISO2_TO_CODE;
  FIFA_NAME = shared.FIFA_NAME_TO_CODE;

  log('gathering teams from BDL + Supabase...');
  const [bdlTeams, intlTeams] = await Promise.all([fetchBdlTeams(), fetchInternationalTeams()]);

  // De-dupe by normalized name; keep the first non-empty code seen.
  const byNameKey = new Map<string, TeamEntry>();
  for (const t of [...bdlTeams, ...intlTeams]) {
    const key = normalizeName(t.name);
    if (!key) continue;
    const existing = byNameKey.get(key);
    if (!existing) byNameKey.set(key, { name: t.name, code: t.code });
    else if (!existing.code && t.code) existing.code = t.code;
  }
  const teams = Array.from(byNameKey.values());
  log(`resolving flags for ${teams.length} unique teams...`);

  const byName: Record<string, string> = {};
  const byCode: Record<string, string> = {};
  const unresolved: Array<{ name: string; code: string | null; tried: string[] }> = [];

  let resolved = 0;
  for (const team of teams) {
    const candidates = candidateSlugs(team);
    let picked: string | null = null;
    for (const slug of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await slugIsValid(slug)) {
        picked = slug;
        break;
      }
    }
    if (picked) {
      resolved++;
      byName[normalizeName(team.name)] = picked;
      const code = String(team.code || '').trim().toLowerCase();
      if (code) byCode[code] = picked;
    } else {
      unresolved.push({ name: team.name, code: team.code, tried: candidates });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    note: 'Generated by scripts/build-world-cup-flag-map.ts. Maps World Cup / international team names and country codes to ESPN flag slugs that were verified to return a real image. Do not edit by hand.',
    byCode,
    byName,
    unresolved: unresolved.map((u) => ({ name: u.name, code: u.code })),
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');

  log(`done — ${resolved}/${teams.length} teams resolved to a verified flag.`);
  log(`wrote ${Object.keys(byName).length} name entries + ${Object.keys(byCode).length} code entries to data/world-cup-flag-map.json`);
  if (unresolved.length) {
    log(`⚠️ ${unresolved.length} teams still have NO flag (add to lib/worldCupFlags.ts FIFA_NAME_TO_CODE):`);
    for (const u of unresolved) {
      console.log(`   • "${u.name}" (code=${u.code ?? 'none'}) tried: [${u.tried.join(', ') || 'none'}]`);
    }
  }
}

main().catch((err) => {
  console.error('[flag-map] failed', err);
  process.exitCode = 1;
});
