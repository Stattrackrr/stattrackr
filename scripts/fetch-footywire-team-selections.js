#!/usr/bin/env node

/**
 * Fetch AFL team selections HTML from Footywire for offline / CI fallback.
 * The API parses data/afl-team-selections-snapshot.html when live FootyWire is unavailable.
 *
 *   node scripts/fetch-footywire-team-selections.js
 *   node scripts/fetch-footywire-team-selections.js --allow-stale
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const FOOTYWIRE_URL = 'https://www.footywire.com/afl/footy/afl_team_selections';
const FETCH_ATTEMPTS = 5;
const FETCH_RETRY_BASE_MS = 2500;
const FOOTYWIRE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://www.footywire.com/',
};

const HTML_PATH = path.join(process.cwd(), 'data', 'afl-team-selections-snapshot.html');
const META_PATH = path.join(process.cwd(), 'data', 'afl-team-selections-snapshot.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFootywireUnavailableStatus(status) {
  return status === 429 || status === 502 || status === 503;
}

function snapshotLooksValid(html) {
  if (!html || html.length < 5000) return false;
  return /afl_team_selections|tbtitle/i.test(html) && /Interchange/i.test(html);
}

function existingSnapshotLooksValid() {
  try {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    return snapshotLooksValid(html);
  } catch {
    return false;
  }
}

async function fetchHtml() {
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(FOOTYWIRE_URL, { headers: FOOTYWIRE_HEADERS });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (isFootywireUnavailableStatus(res.status)) break;
      } else {
        const html = await res.text();
        if (snapshotLooksValid(html)) return { ok: true, html };
        lastError = 'parsed page missing expected lineup markers';
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < FETCH_ATTEMPTS) {
      await sleep(FETCH_RETRY_BASE_MS * attempt);
    }
  }
  return { ok: false, error: lastError };
}

async function probeFootywireSelections() {
  try {
    const res = await fetch(FOOTYWIRE_URL, { headers: FOOTYWIRE_HEADERS });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const allowStale = process.argv.includes('--allow-stale');

  if (allowStale && existingSnapshotLooksValid()) {
    const probe = await probeFootywireSelections();
    if (!probe.ok && (isFootywireUnavailableStatus(probe.status) || probe.status === 0)) {
      console.warn(
        `FootyWire unavailable (HTTP ${probe.status || probe.error || 'error'}). Keeping existing snapshot:`,
        HTML_PATH,
      );
      return;
    }
  }

  console.log('Fetching Footywire AFL team selections...');
  console.log(`  ${FOOTYWIRE_URL}`);

  const result = await fetchHtml();
  if (!result.ok) {
    if (allowStale && existingSnapshotLooksValid()) {
      console.warn(
        `FootyWire unavailable (${result.error}). Keeping existing snapshot:`,
        HTML_PATH,
      );
      return;
    }
    console.error(`Failed to fetch team selections: ${result.error}`);
    process.exit(1);
  }

  const dataDir = path.dirname(HTML_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(HTML_PATH, result.html, 'utf8');
  fs.writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: 'footywire.com',
        sourcePage: 'afl_team_selections',
        byteLength: Buffer.byteLength(result.html, 'utf8'),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`\nWrote snapshot (${result.html.length} chars) to ${HTML_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
