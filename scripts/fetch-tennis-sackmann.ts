#!/usr/bin/env tsx
/**
 * Cache Jeff Sackmann ATP/WTA match CSVs (last 3 years) into data/tennis/.
 * Primary source is the Hugging Face archive (GitHub raw often 404s).
 * Usage: npx tsx scripts/fetch-tennis-sackmann.ts
 */
import fs from 'fs';
import path from 'path';
import { TENNIS_HISTORY_YEARS, tennisDataDir } from '../lib/tennis/sackmann';

const HF =
  'https://huggingface.co/datasets/Aneeshers/tennis-sackmann-archive/resolve/main';
const GH_ARCHIVE =
  'https://github.com/Aneeshers/tennis-sackmann-archive/raw/main';
const JSDELIVR_ATP = 'https://cdn.jsdelivr.net/gh/JeffSackmann/tennis_atp@master';
const JSDELIVR_WTA = 'https://cdn.jsdelivr.net/gh/JeffSackmann/tennis_wta@master';

type CacheFile = { file: string; urls: string[] };

function filesForYears(): CacheFile[] {
  const files: CacheFile[] = [];
  for (const year of TENNIS_HISTORY_YEARS) {
    files.push({
      file: `atp_matches_${year}.csv`,
      urls: [
        `${HF}/atp/atp_matches_${year}.csv`,
        `${GH_ARCHIVE}/atp/atp_matches_${year}.csv`,
        `${JSDELIVR_ATP}/atp_matches_${year}.csv`,
      ],
    });
    files.push({
      file: `wta_matches_${year}.csv`,
      urls: [
        `${HF}/wta/wta_matches_${year}.csv`,
        `${GH_ARCHIVE}/wta/wta_matches_${year}.csv`,
        `${JSDELIVR_WTA}/wta_matches_${year}.csv`,
      ],
    });
    files.push({
      file: `atp_matches_qual_chall_${year}.csv`,
      urls: [
        `${HF}/atp/atp_matches_qual_chall_${year}.csv`,
        `${GH_ARCHIVE}/atp/atp_matches_qual_chall_${year}.csv`,
        `${JSDELIVR_ATP}/atp_matches_qual_chall_${year}.csv`,
      ],
    });
    files.push({
      file: `wta_matches_qual_itf_${year}.csv`,
      urls: [
        `${HF}/wta/wta_matches_qual_itf_${year}.csv`,
        `${GH_ARCHIVE}/wta/wta_matches_qual_itf_${year}.csv`,
        `${JSDELIVR_WTA}/wta_matches_qual_itf_${year}.csv`,
      ],
    });
  }
  files.push(
    {
      file: 'atp_rankings_current.csv',
      urls: [
        `${HF}/atp/atp_rankings_current.csv`,
        `${GH_ARCHIVE}/atp/atp_rankings_current.csv`,
        `${JSDELIVR_ATP}/atp_rankings_current.csv`,
      ],
    },
    {
      file: 'wta_rankings_current.csv',
      urls: [
        `${HF}/wta/wta_rankings_current.csv`,
        `${GH_ARCHIVE}/wta/wta_rankings_current.csv`,
        `${JSDELIVR_WTA}/wta_rankings_current.csv`,
      ],
    }
  );
  return files;
}

const FETCH_HEADERS = {
  'User-Agent': 'stattrackr-tennis-cache',
  Accept: 'text/csv,text/plain,*/*',
};

async function download(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.text();
}

function looksLikeCsv(body: string): boolean {
  const first = body.trimStart().slice(0, 80).toLowerCase();
  return first.includes('tourney_id') || first.includes('ranking_date') || first.includes('player_id');
}

async function fetchOne(item: CacheFile): Promise<string> {
  let lastError: unknown = null;
  for (const url of item.urls) {
    try {
      const body = await download(url);
      if (!looksLikeCsv(body) || body.length < 80) {
        throw new Error(`not a CSV (${body.length} bytes)`);
      }
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`all mirrors failed for ${item.file}`);
}

async function main() {
  const dir = tennisDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const items = filesForYears();
  const manifest: Array<{ file: string; bytes: number; rows: number }> = [];
  for (const item of items) {
    try {
      const body = await fetchOne(item);
      const dest = path.join(dir, item.file);
      fs.writeFileSync(dest, body);
      const rows = body.split(/\r?\n/).filter((line) => line.trim()).length - 1;
      manifest.push({ file: item.file, bytes: Buffer.byteLength(body), rows });
      console.log(`Wrote data/tennis/${item.file} (${rows} rows)`);
    } catch (error) {
      console.warn(`Could not fetch ${item.file}:`, error instanceof Error ? error.message : error);
    }
  }
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        years: [...TENNIS_HISTORY_YEARS],
        files: manifest,
      },
      null,
      2
    )
  );
  console.log(`Cached ${manifest.length}/${items.length} files`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
