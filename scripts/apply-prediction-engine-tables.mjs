import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HISTORY_PATH = path.join(ROOT, 'data', 'afl-model', 'history', 'top-picks-history.json');
const PROJECTIONS_PATH = path.join(ROOT, 'data', 'afl-model', 'latest-disposals-projections.json');

function readJsonFileAnyEncoding(filePath) {
  const raw = fs.readFileSync(filePath);
  let text;
  const looksUtf16Le =
    (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) ||
    (raw.length >= 4 && raw[1] === 0 && raw[3] === 0 && (raw[0] === 0x7b || raw[0] === 0x5b || raw[0] === 0x22));
  if (looksUtf16Le) {
    text = raw.toString('utf16le').replace(/^\uFEFF/, '');
  } else if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const body = raw.subarray(2);
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i < body.length - 1; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    text = swapped.toString('utf16le');
  } else {
    text = raw.toString('utf8').replace(/^\uFEFF/, '');
  }
  return JSON.parse(text);
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function parseArgs(argv) {
  const readNumberArg = (name, fallback) => {
    const raw = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const nowRaw = argv.find((arg) => arg.startsWith('--now='))?.slice('--now='.length);
  const now = nowRaw ? new Date(nowRaw) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid --now value: ${nowRaw}`);
  }
  return {
    file: argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length) ?? null,
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    snapshot: argv.includes('--snapshot'),
    windowHours: readNumberArg('--window-hours', 2),
    limitPerGame: Math.max(0, Math.min(10, Math.floor(readNumberArg('--limit-per-game', 3)))),
    now,
  };
}

function normalizeTeam(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function buildGameKey(homeTeam, awayTeam, commenceTimeOrDate) {
  return `${normalizeTeam(homeTeam)}|${normalizeTeam(awayTeam)}|${String(commenceTimeOrDate ?? '').slice(0, 10)}`;
}

function weekKeyFromCommenceTime(commenceTime) {
  if (!commenceTime) return null;
  const parsed = new Date(commenceTime);
  return Number.isNaN(parsed.getTime()) ? null : isoWeekKey(parsed);
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^\+/, '').replace(/%$/, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRate(value) {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

function normalizeSide(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'OVER' || raw === 'O') return 'OVER';
  if (raw === 'UNDER' || raw === 'U') return 'UNDER';
  return null;
}

function normalizeRecord(record) {
  const homeTeam = String(record.homeTeam ?? '').trim();
  const awayTeam = String(record.awayTeam ?? '').trim();
  const commenceTime = record.commenceTime != null ? String(record.commenceTime) : record.gameDate ?? null;
  const gameKey = String(record.gameKey ?? '').trim() || buildGameKey(homeTeam, awayTeam, commenceTime);
  const picks = (record.picks ?? []).slice(0, 3).map((pick, idx) => ({
    playerName: String(pick.playerName ?? '').trim(),
    bookmaker: pick.bookmaker != null ? String(pick.bookmaker).trim() : null,
    line: parseNumber(pick.line),
    expectedDisposals: parseNumber(pick.expectedDisposals),
    recommendedSide: normalizeSide(pick.recommendedSide ?? pick.side),
    recommendedEdge: parseRate(pick.recommendedEdge ?? pick.edge),
    recommendedProb: parseRate(pick.recommendedProb ?? pick.probability),
    rank: parseNumber(pick.rank) ?? idx + 1,
    actualDisposals: parseNumber(pick.actualDisposals),
  }));
  return {
    gameKey,
    finalizedAt: record.finalizedAt ?? new Date().toISOString(),
    windowHours: parseNumber(record.windowHours) ?? 2,
    projectionGeneratedAt: record.projectionGeneratedAt ?? null,
    modelVersion: record.modelVersion ?? 'manual-backfill',
    homeTeam,
    awayTeam,
    commenceTime,
    weekKey: record.weekKey ?? weekKeyFromCommenceTime(commenceTime),
    roundKey: record.roundKey != null ? String(record.roundKey).trim() || null : null,
    picks,
  };
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    const ac = String(a.commenceTime ?? '');
    const bc = String(b.commenceTime ?? '');
    if (ac !== bc) return ac.localeCompare(bc);
    return a.gameKey.localeCompare(b.gameKey);
  });
}

function readHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { generatedAt: new Date().toISOString(), count: 0, records: [] };
  }
  try {
    const parsed = readJsonFileAnyEncoding(HISTORY_PATH);
    const records = Array.isArray(parsed.records) ? parsed.records.map(normalizeRecord) : [];
    return { generatedAt: parsed.generatedAt ?? new Date().toISOString(), count: records.length, records: sortRecords(records) };
  } catch {
    return { generatedAt: new Date().toISOString(), count: 0, records: [] };
  }
}

function upsertHistory(incomingRecords, { force = false, generatedAt = new Date().toISOString() } = {}) {
  const history = readHistory();
  const byGame = new Map(history.records.map((record) => [record.gameKey, record]));
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  for (const record of incomingRecords) {
    const normalized = normalizeRecord(record);
    if (!normalized.gameKey) continue;
    if (byGame.has(normalized.gameKey) && !force) {
      skipped += 1;
      continue;
    }
    if (byGame.has(normalized.gameKey)) replaced += 1;
    else added += 1;
    byGame.set(normalized.gameKey, normalized);
  }
  const records = sortRecords([...byGame.values()]);
  if (added > 0 || replaced > 0) {
    writeUtf8(HISTORY_PATH, `${JSON.stringify({ generatedAt, count: records.length, records }, null, 2)}\n`);
  }
  return { added, replaced, skipped, records };
}

function readBackfillPayload(filePath) {
  const resolved = path.resolve(ROOT, filePath);
  const parsed = readJsonFileAnyEncoding(resolved);
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) throw new Error('Backfill file must be an array or { records: [] }.');
  writeUtf8(resolved, `${JSON.stringify(records, null, 2)}\n`);
  return records;
}

function parseRoundKey(roundKey) {
  const match = String(roundKey ?? '').trim().match(/^(\d{4})-R(\d{1,2})$/i);
  if (!match) return null;
  const season = Number.parseInt(match[1], 10);
  const round = Number.parseInt(match[2], 10);
  if (!Number.isFinite(season) || !Number.isFinite(round)) return null;
  return { season, round };
}

function sortRoundKeys(roundKeys) {
  return [...roundKeys].sort((a, b) => {
    const ar = parseRoundKey(a);
    const br = parseRoundKey(b);
    if (!ar && !br) return a.localeCompare(b);
    if (!ar) return 1;
    if (!br) return -1;
    if (ar.season !== br.season) return ar.season - br.season;
    return ar.round - br.round;
  });
}

function buildRoundLookup(records) {
  const lookup = new Map();
  for (const record of records) {
    if (!record.roundKey) continue;
    lookup.set(record.gameKey, record.roundKey);
  }
  return lookup;
}

function inferRoundKey(commenceTime, records) {
  if (!commenceTime) return null;
  const date = commenceTime.slice(0, 10);
  const weekKey = weekKeyFromCommenceTime(commenceTime);
  const withRound = records.filter((record) => record.roundKey && record.commenceTime);
  if (weekKey) {
    const sameWeekRoundKeys = sortRoundKeys(
      Array.from(new Set(withRound.filter((record) => record.weekKey === weekKey).map((record) => record.roundKey)))
    );
    if (sameWeekRoundKeys.length > 0) {
      return sameWeekRoundKeys[sameWeekRoundKeys.length - 1] ?? null;
    }
  }
  const roundBounds = new Map();
  for (const record of withRound) {
    const gameDate = String(record.commenceTime).slice(0, 10);
    const roundKey = record.roundKey;
    const bounds = roundBounds.get(roundKey) ?? { min: gameDate, max: gameDate };
    if (gameDate < bounds.min) bounds.min = gameDate;
    if (gameDate > bounds.max) bounds.max = gameDate;
    roundBounds.set(roundKey, bounds);
  }
  for (const [roundKey, bounds] of roundBounds) {
    if (date >= bounds.min && date <= bounds.max) return roundKey;
  }
  return null;
}

function mergePicks(primaryPicks, secondaryPicks) {
  const secondaryByPlayer = new Map(secondaryPicks.map((pick) => [pick.playerName.toLowerCase(), pick]));
  return primaryPicks.map((pick, idx) => {
    const secondary = secondaryByPlayer.get(pick.playerName.toLowerCase()) ?? secondaryPicks[idx];
    return {
      ...pick,
      bookmaker: pick.bookmaker ?? secondary?.bookmaker ?? null,
      actualDisposals: pick.actualDisposals ?? secondary?.actualDisposals ?? null,
    };
  });
}

function mergeSnapshotRecord(existing, incoming, roundLookup, allRecords) {
  const roundKey =
    incoming.roundKey ??
    existing?.roundKey ??
    roundLookup.get(incoming.gameKey) ??
    inferRoundKey(incoming.commenceTime, allRecords);
  if (!existing) return normalizeRecord({ ...incoming, roundKey });
  return normalizeRecord({
    ...existing,
    ...incoming,
    roundKey,
    picks: mergePicks(incoming.picks, existing.picks),
  });
}

function loadProjectionPayload() {
  if (!fs.existsSync(PROJECTIONS_PATH)) {
    return { generatedAt: null, modelVersion: null, rows: [] };
  }
  try {
    return readJsonFileAnyEncoding(PROJECTIONS_PATH);
  } catch {
    return { generatedAt: null, modelVersion: null, rows: [] };
  }
}

function loadProjectionGames(payload) {
  const out = new Map();
  for (const row of payload?.rows ?? []) {
    const gameKey = String(row.gameKey ?? '').trim();
    if (!gameKey || out.has(gameKey)) continue;
    out.set(gameKey, {
      gameKey,
      homeTeam: String(row.homeTeam ?? '').trim(),
      awayTeam: String(row.awayTeam ?? '').trim(),
      commenceTime: row.commenceTime != null ? String(row.commenceTime) : null,
    });
  }
  return out;
}

function getTopPicksByGame(payload, limitPerGame = 3) {
  const rows = payload?.rows ?? [];
  const byGame = new Map();
  for (const row of rows) {
    if (!row.isTop3PickInGame) continue;
    const gameKey = String(row.gameKey ?? '').trim();
    if (!gameKey) continue;
    const list = byGame.get(gameKey);
    if (list) list.push(row);
    else byGame.set(gameKey, [row]);
  }
  const out = new Map();
  for (const [gameKey, gameRows] of byGame.entries()) {
    gameRows.sort(
      (a, b) =>
        (parseNumber(a.recommendedPlayerRankInGame) ?? 999) - (parseNumber(b.recommendedPlayerRankInGame) ?? 999)
    );
    const selected = gameRows.slice(0, limitPerGame);
    if (selected.length === 0) continue;
    const first = selected[0];
    out.set(gameKey, {
      gameKey,
      homeTeam: String(first.homeTeam ?? ''),
      awayTeam: String(first.awayTeam ?? ''),
      commenceTime: first.commenceTime != null ? String(first.commenceTime) : null,
      picks: selected.map((row, idx) => ({
        playerName: String(row.playerName ?? ''),
        bookmaker: row.bookmaker != null ? String(row.bookmaker) : null,
        line: parseNumber(row.line),
        expectedDisposals: parseNumber(row.expectedDisposals),
        recommendedSide: normalizeSide(row.recommendedSide),
        recommendedEdge: parseRate(row.recommendedEdge),
        recommendedProb: parseRate(row.recommendedProb),
        rank: parseNumber(row.recommendedPlayerRankInGame) ?? idx + 1,
      })),
    });
  }
  return out;
}

function isWithinFinalizeWindow(commenceTime, now, windowHours) {
  if (!commenceTime) return false;
  const kickoff = Date.parse(commenceTime);
  if (!Number.isFinite(kickoff)) return false;
  const diffMs = kickoff - now.getTime();
  return diffMs >= 0 && diffMs <= windowHours * 60 * 60 * 1000;
}

function runSnapshot(args) {
  const nowIso = args.now.toISOString();
  const payload = loadProjectionPayload();
  const games = loadProjectionGames(payload);
  const topPicksByGame = getTopPicksByGame(payload, args.limitPerGame);
  const history = readHistory();
  const existingByGame = new Map(history.records.map((record) => [record.gameKey, record]));
  const nextRecords = [...history.records];
  const roundLookup = buildRoundLookup(nextRecords);
  let added = 0;
  let replaced = 0;
  let skippedFinalized = 0;
  let eligible = 0;

  for (const game of games.values()) {
    const kickoffMs = game.commenceTime ? Date.parse(game.commenceTime) : Number.NaN;
    const isPastGame = Number.isFinite(kickoffMs) && kickoffMs < args.now.getTime();
    if (isPastGame) continue;
    if (!isWithinFinalizeWindow(game.commenceTime, args.now, args.windowHours)) continue;
    eligible += 1;
    const existing = existingByGame.get(game.gameKey);
    if (existing && !args.force) {
      skippedFinalized += 1;
      continue;
    }
    const picks = topPicksByGame.get(game.gameKey)?.picks ?? [];
    const incoming = normalizeRecord({
      gameKey: game.gameKey,
      finalizedAt: nowIso,
      windowHours: args.windowHours,
      projectionGeneratedAt: payload.generatedAt ?? null,
      modelVersion: payload.modelVersion ?? null,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      weekKey: weekKeyFromCommenceTime(game.commenceTime),
      roundKey: inferRoundKey(game.commenceTime, nextRecords),
      picks,
    });
    const record = mergeSnapshotRecord(existing, incoming, roundLookup, nextRecords);
    if (existing) {
      const index = nextRecords.findIndex((row) => row.gameKey === game.gameKey);
      if (index >= 0) nextRecords[index] = record;
      replaced += 1;
    } else {
      nextRecords.push(record);
      added += 1;
    }
    existingByGame.set(game.gameKey, record);
  }

  const sortedRecords = sortRecords(nextRecords);
  console.log(
    [
      `[afl-top-picks] eligible=${eligible}`,
      `added=${added}`,
      `replaced=${replaced}`,
      `skippedFinalized=${skippedFinalized}`,
      `total=${sortedRecords.length}`,
      `dryRun=${args.dryRun}`,
    ].join(' ')
  );

  for (const record of sortedRecords.filter((record) => record.finalizedAt === nowIso)) {
    console.log(
      `[afl-top-picks] finalized ${record.homeTeam} vs ${record.awayTeam} ${record.commenceTime ?? ''} picks=${record.picks.length}`
    );
  }

  if (added === 0 && replaced === 0) {
    console.log('[afl-top-picks] no history changes to write');
    return;
  }

  if (!args.dryRun) {
    writeUtf8(
      HISTORY_PATH,
      `${JSON.stringify({ generatedAt: nowIso, count: sortedRecords.length, records: sortedRecords }, null, 2)}\n`
    );
  }
}

function runBackfill(args) {
  if (!args.file) throw new Error('Missing --file=path/to/backfill.json');

  const nowIso = new Date().toISOString();
  const incoming = readBackfillPayload(args.file).map(normalizeRecord);
  const history = readHistory();
  const existingByGame = new Set(history.records.map((record) => record.gameKey));
  const added = incoming.filter((record) => !existingByGame.has(record.gameKey)).length;
  const replaced = incoming.filter((record) => existingByGame.has(record.gameKey)).length;
  const skipped = args.force ? 0 : replaced;

  console.log(
    [
      `[afl-top-picks-backfill] incoming=${incoming.length}`,
      `added=${added}`,
      `replaced=${args.force ? replaced : 0}`,
      `skipped=${skipped}`,
      `force=${args.force}`,
      `dryRun=${args.dryRun}`,
    ].join(' ')
  );

  for (const record of incoming) {
    console.log(
      `[afl-top-picks-backfill] ${record.roundKey ?? record.weekKey ?? 'no-round'} ${record.homeTeam} vs ${record.awayTeam} ${record.commenceTime ?? ''} picks=${record.picks.length}`
    );
  }

  if (!args.dryRun) {
    const result = upsertHistory(incoming, { force: args.force, generatedAt: nowIso });
    console.log(`[afl-top-picks-backfill] wrote ${HISTORY_PATH} records=${result.records.length}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.snapshot) {
  runSnapshot(args);
} else {
  runBackfill(args);
}
