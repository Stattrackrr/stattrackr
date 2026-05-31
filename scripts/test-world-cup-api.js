#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILES = ['.env.local', '.env.development.local', '.env'];
const loadedEnvFiles = [];

for (const file of ENV_FILES) {
  const fullPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(fullPath)) continue;
  const parsed = dotenv.config({ path: fullPath, override: false, quiet: true });
  loadedEnvFiles.push({ file, count: parsed.parsed ? Object.keys(parsed.parsed).length : 0 });
}

const API_KEY = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
const BASE_URL = 'https://api.balldontlie.io/fifa/worldcup/v1';

const checks = [
  { label: 'Teams (free)', path: '/teams', params: { 'seasons[]': '2026' } },
  { label: 'Stadiums (free)', path: '/stadiums', params: { 'seasons[]': '2026' } },
  { label: 'Group standings (ALL-STAR+)', path: '/group_standings', params: { 'seasons[]': '2026' } },
  { label: 'Matches (GOAT)', path: '/matches', params: { 'seasons[]': '2026', per_page: '5' } },
  { label: 'Players search Ronaldo (GOAT)', path: '/players', params: { search: 'ronaldo', per_page: '5' } },
  { label: 'Rosters (GOAT)', path: '/rosters', params: { 'seasons[]': '2026', per_page: '5' } },
  { label: 'Futures odds (GOAT)', path: '/odds/futures', params: { 'seasons[]': '2026' } },
];

async function inspectRonaldo() {
  const playerUrl = buildUrl('/players', { search: 'ronaldo', per_page: '5' });
  const playerResult = await fetchWithAuthFallback(playerUrl);
  if (!playerResult?.response.ok) return;
  const playerPayload = JSON.parse(playerResult.text);
  const player = Array.isArray(playerPayload?.data) ? playerPayload.data[0] : null;
  if (!player?.id) return;

  console.log('Ronaldo inspect');
  console.log(`  player_id: ${player.id}`);
  console.log(`  country: ${player.country_name || player.country_code || 'n/a'}`);

  const statsUrl = buildUrl('/player_match_stats', { 'player_ids[]': String(player.id), per_page: '10' });
  const statsResult = await fetchWithAuthFallback(statsUrl);
  const statsPayload = statsResult?.text ? JSON.parse(statsResult.text) : null;
  const statsRows = Array.isArray(statsPayload?.data) ? statsPayload.data : [];
  console.log(`  player_match_stats rows: ${statsRows.length}`);
  if (statsRows[0]) {
    console.log(`  first stat match_id: ${statsRows[0].match_id}`);
    console.log(`  first stat non-null keys: ${Object.entries(statsRows[0]).filter(([, value]) => value != null).map(([key]) => key).join(', ')}`);
    console.log(`  first stat sample: ${JSON.stringify(statsRows[0], null, 2).slice(0, 900)}`);
  }

  const matchIds = statsRows.map((row) => row.match_id).filter(Boolean).slice(0, 10);
  if (matchIds.length) {
    const shotParams = { 'player_ids[]': String(player.id), per_page: '25' };
    matchIds.forEach((id, index) => {
      shotParams[`match_ids[${index}]`] = String(id);
    });
    const shotUrl = new URL(`${BASE_URL}/match_shots`);
    shotUrl.searchParams.set('player_ids[]', String(player.id));
    shotUrl.searchParams.set('per_page', '25');
    matchIds.forEach((id) => shotUrl.searchParams.append('match_ids[]', String(id)));
    const shotResult = await fetchWithAuthFallback(shotUrl);
    const shotPayload = shotResult?.text ? JSON.parse(shotResult.text) : null;
    const shotRows = Array.isArray(shotPayload?.data) ? shotPayload.data : [];
    console.log(`  match_shots rows for first ${matchIds.length} stat matches: ${shotRows.length}`);
    if (shotRows[0]) {
      console.log(`  first shot sample: ${JSON.stringify(shotRows[0], null, 2).slice(0, 600)}`);
    }
  }
  console.log('');
}

function buildUrl(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  return url;
}

function authHeaders(candidate) {
  return {
    Accept: 'application/json',
    'User-Agent': 'StatTrackr/1.0',
    Authorization: candidate,
  };
}

function authCandidates() {
  if (!API_KEY) return [];
  if (API_KEY.toLowerCase().startsWith('bearer ')) {
    const raw = API_KEY.replace(/^bearer\s+/i, '').trim();
    return [raw, API_KEY].filter(Boolean);
  }
  return [API_KEY, `Bearer ${API_KEY}`];
}

async function fetchWithAuthFallback(url) {
  let lastResult = null;
  for (const candidate of authCandidates()) {
    const response = await fetch(url, { headers: authHeaders(candidate), cache: 'no-store' });
    const text = await response.text();
    lastResult = { response, text };
    if (response.ok || response.status !== 401) return lastResult;
  }
  return lastResult;
}

function summarizePayload(text) {
  try {
    const payload = JSON.parse(text);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const first = data[0] || null;
    const firstLabel =
      first?.name ||
      first?.homeLabel ||
      first?.home_team?.name ||
      first?.player?.name ||
      first?.subject?.name ||
      first?.market_name ||
      null;
    return {
      count: data.length,
      nextCursor: payload?.meta?.next_cursor ?? null,
      firstLabel,
      error: payload?.error || null,
    };
  } catch {
    return { count: null, nextCursor: null, firstLabel: null, error: text.slice(0, 180) };
  }
}

async function main() {
  console.log('FIFA World Cup BDL API smoke test');
  console.log(
    'Env files:',
    loadedEnvFiles.length
      ? loadedEnvFiles.map((entry) => `${entry.file} (${entry.count} keys)`).join(', ')
      : 'none found'
  );
  console.log('Env key:', API_KEY ? 'found' : 'missing');
  console.log('');

  if (!API_KEY) {
    console.error('Missing BALLDONTLIE_API_KEY or BALL_DONT_LIE_API_KEY.');
    console.error('Checked .env.local, .env.development.local, and .env from the repo root.');
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const check of checks) {
    const url = buildUrl(check.path, check.params);
    try {
      const result = await fetchWithAuthFallback(url);
      if (!result) {
        failures++;
        console.log(`FAIL ${check.label}: no auth candidates`);
        continue;
      }

      const { response, text } = result;
      const summary = summarizePayload(text);
      const status = response.ok ? 'OK' : 'FAIL';
      if (!response.ok) failures++;

      console.log(`${status} ${check.label}`);
      console.log(`  HTTP ${response.status}`);
      console.log(`  rows: ${summary.count ?? 'n/a'}${summary.nextCursor ? `, next_cursor: ${summary.nextCursor}` : ''}`);
      if (summary.firstLabel) console.log(`  first: ${summary.firstLabel}`);
      if (summary.error) console.log(`  message: ${summary.error}`);
    } catch (error) {
      failures++;
      console.log(`FAIL ${check.label}`);
      console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log('');
  }

  await inspectRonaldo();

  if (failures > 0) {
    console.log(`${failures} check(s) failed. A 401 on GOAT endpoints usually means the World Cup sport tier is not active yet.`);
    process.exitCode = 1;
    return;
  }

  console.log('All World Cup API checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
