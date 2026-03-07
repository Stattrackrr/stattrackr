#!/usr/bin/env node

/**
 * Load AFL DvP file and print per-team, per-position rankings (disposals + goals).
 * Use this to verify rankings before the cron uses them.
 *
 * Usage:
 *   node scripts/run-afl-dvp-rankings.js
 *   node scripts/run-afl-dvp-rankings.js --season=2025
 *   node scripts/run-afl-dvp-rankings.js --build   # rebuild DvP file first, then print rankings
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function hasBuild() {
  return process.argv.includes('--build');
}

const STAT_TO_OA_CODE = { disposals: 'D', goals: 'G' };
const OPPONENT_TO_OA_TEAM = {
  adelaide: 'Crows', brisbane: 'Lions', carlton: 'Blues', collingwood: 'Magpies', essendon: 'Bombers',
  fremantle: 'Dockers', geelong: 'Cats', 'gold coast': 'Suns', gws: 'Giants', hawthorn: 'Hawks',
  melbourne: 'Demons', 'north melbourne': 'Kangaroos', 'port adelaide': 'Power', richmond: 'Tigers',
  'st kilda': 'Saints', sydney: 'Swans', 'west coast': 'Eagles', 'western bulldogs': 'Bulldogs',
};

function isValidOpponent(opp) {
  const s = String(opp || '').trim();
  if (s.length < 3) return false;
  if (/^\d+$/.test(s)) return false;
  return true;
}

function loadOaFile(dataDir, season) {
  try {
    const p = path.join(dataDir, `afl-team-rankings-${season}-oa.json`);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildFromFileRows(rows, stat, useTeamTotal = true) {
  const byOpponentPosition = new Map();
  const originalOpponentByKey = new Map();
  const source = useTeamTotal ? 'perTeamGame' : 'perPlayerGame';
  for (const row of rows) {
    const raw = (row.opponent || '').trim();
    const opp = raw.toLowerCase();
    const pos = (row.position || 'MID').trim().toUpperCase();
    if (!opp || !isValidOpponent(opp)) continue;
    const val = Number(row[source]?.[stat] ?? 0);
    const key = `${opp}|${pos}`;
    byOpponentPosition.set(key, val);
    if (!originalOpponentByKey.has(key)) originalOpponentByKey.set(key, row.opponent ?? raw);
  }
  const positions = [...new Set([...byOpponentPosition.keys()].map((k) => k.split('|')[1]).filter(Boolean))].sort();
  const result = { byKey: new Map(), byPosition: {} };
  for (const pos of positions) {
    const entries = [...byOpponentPosition.entries()]
      .filter(([k]) => k.endsWith(`|${pos}`))
      .map(([k, v]) => {
        const opp = k.replace(/\|[^|]+$/, '');
        const original = originalOpponentByKey.get(k) || opp;
        return [original, v];
      });
    const sorted = entries.sort((a, b) => a[1] - b[1]);
    const ranked = sorted.map(([opponent, value], i) => ({ opponent, rank: i + 1, value }));
    result.byPosition[pos] = ranked;
    for (const [opponent, value] of sorted) {
      result.byKey.set(`${opponent.toLowerCase()}|${pos}`, { rank: ranked.find((r) => r.opponent === opponent).rank, value });
    }
  }
  return result;
}

function calibrateWithOa(rows, result, stat, oa) {
  if (!oa?.teams?.length || !STAT_TO_OA_CODE[stat]) return result;
  const oaCode = STAT_TO_OA_CODE[stat];
  const sumByOpponent = {};
  for (const row of rows) {
    const opp = row.opponent ?? '';
    const v = Number(row.perTeamGame?.[stat] ?? 0);
    if (Number.isFinite(v)) sumByOpponent[opp] = (sumByOpponent[opp] || 0) + v;
  }
  const byOpponentPosition = new Map();
  for (const pos of ['DEF', 'MID', 'FWD', 'RUC']) {
    const list = result.byPosition[pos];
    if (!list) continue;
    for (const { opponent, value } of list) {
      const oppNorm = opponent.trim().toLowerCase().replace(/\s+/g, ' ');
      const oaTeam = OPPONENT_TO_OA_TEAM[oppNorm] || OPPONENT_TO_OA_TEAM[oppNorm.replace(/\s+/g, '')];
      if (!oaTeam) continue;
      const oaRow = oa.teams.find((t) => String(t.team || '').toLowerCase() === oaTeam.toLowerCase());
      const oaValue = oaRow?.stats?.[oaCode] != null ? Number(oaRow.stats[oaCode]) : NaN;
      const denom = Number(sumByOpponent[opponent] ?? 0);
      if (!Number.isFinite(oaValue) || oaValue <= 0 || !Number.isFinite(denom) || denom <= 0) continue;
      const scaled = Math.round((value * oaValue) / denom * 100) / 100;
      byOpponentPosition.set(`${opponent}|${pos}`, scaled);
    }
  }
  const out = { byKey: new Map(), byPosition: {} };
  for (const pos of ['DEF', 'MID', 'FWD', 'RUC']) {
    const list = result.byPosition[pos];
    if (!list) continue;
    const entries = list.map(({ opponent, value }) => {
      const scaled = byOpponentPosition.get(`${opponent}|${pos}`);
      return [opponent, scaled != null ? scaled : value];
    });
    const sorted = entries.sort((a, b) => a[1] - b[1]);
    const ranked = sorted.map(([opponent, value], i) => ({ opponent, rank: i + 1, value }));
    out.byPosition[pos] = ranked;
  }
  return out;
}

function toTitle(s) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function run() {
  const dataDir = path.join(process.cwd(), 'data');
  const explicitSeason = getArg('season', '');
  let filePath = null;
  let season = explicitSeason ? String(parseInt(explicitSeason, 10) || new Date().getFullYear()) : '';

  if (explicitSeason) {
    filePath = path.join(dataDir, `afl-dvp-${season}.json`);
  }
  if (!filePath || !fs.existsSync(filePath)) {
    const year = new Date().getFullYear();
    const tryYears = season ? [parseInt(season, 10)] : [year, year - 1, year - 2];
    for (const y of tryYears) {
      if (!y) continue;
      const p = path.join(dataDir, `afl-dvp-${y}.json`);
      if (fs.existsSync(p)) {
        filePath = p;
        season = String(y);
        break;
      }
    }
  }
  if (!filePath) filePath = path.join(dataDir, `afl-dvp-${season || new Date().getFullYear()}.json`);
  if (!season) season = path.basename(filePath).replace(/^afl-dvp-|\.json$/g, '') || new Date().getFullYear();

  if (hasBuild()) {
    const buildSeason = parseInt(season, 10) || new Date().getFullYear();
    console.log('Building DvP file first...\n');
    execSync(`node scripts/build-afl-dvp.js --season=${buildSeason}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('');
    filePath = path.join(dataDir, `afl-dvp-${buildSeason}.json`);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`DvP file not found: ${filePath}`);
    console.error('Run with --build to generate it, or run: npm run build:afl:dvp');
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    console.error('No rows in DvP file.');
    process.exit(1);
  }

  const seasonNum = parseInt(season, 10) || new Date().getFullYear();
  const oa = loadOaFile(dataDir, seasonNum);

  let disposals = buildFromFileRows(rows, 'disposals', true);
  let goals = buildFromFileRows(rows, 'goals', true);
  if (oa) {
    disposals = calibrateWithOa(rows, disposals, 'disposals', oa);
    goals = calibrateWithOa(rows, goals, 'goals', oa);
  }

  console.log('=== AFL DvP rankings (per team, per position) — team totals ===');
  console.log(`Season: ${data.season ?? season}`);
  console.log(`Source: ${data.source ?? 'afl-dvp file'}`);
  console.log('Values: per team per game, calibrated to Opponent Breakdown (OA) when afl-team-rankings-*-oa.json present.');
  if (!oa) console.log('(No OA file found — showing raw DvP totals; run fetch-footywire-team-rankings for OA.)');
  console.log('');

  for (const [statLabel, result] of [
    ['Disposals', disposals],
    ['Goals', goals],
  ]) {
    console.log(`--- ${statLabel} ---`);
    for (const pos of ['DEF', 'MID', 'FWD', 'RUC']) {
      const list = result.byPosition[pos];
      if (!list || list.length === 0) continue;
      console.log(`  ${pos}:`);
      for (const { opponent, rank, value } of list) {
        console.log(`    #${String(rank).padStart(2)}  ${toTitle(opponent).padEnd(22)}  ${value.toFixed(2)}`);
      }
      console.log('');
    }
  }

  console.log('(Rank 1 = hardest / lowest allowed; rank 18 = easiest / highest — matches dashboard)');
}

run();
