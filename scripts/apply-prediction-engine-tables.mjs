import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAflGameFinalOnEspn, lookupTopPicksActualFromAltSources } from '../lib/afl/aflTopPicksActualsFallback.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HISTORY_PATH = path.join(ROOT, 'data', 'afl-model', 'history', 'top-picks-history.json');
const LINE_HISTORY_PATH = path.join(ROOT, 'data', 'afl-model', 'history', 'disposals-line-history.json');
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
    enrich: argv.includes('--enrich'),
    baseUrl:
      argv.find((arg) => arg.startsWith('--base-url='))?.slice('--base-url='.length) ??
      process.env.PROD_URL ??
      'http://localhost:3000',
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

/** Official 2026 AFL premiership round windows (Thu–Mon inclusive). */
const AFL_2026_ROUND_WINDOWS = [
  { key: '2026-R14', start: '2026-06-11', end: '2026-06-15' },
  { key: '2026-R15', start: '2026-06-18', end: '2026-06-22' },
  { key: '2026-R16', start: '2026-06-25', end: '2026-06-29' },
  { key: '2026-R17', start: '2026-07-02', end: '2026-07-06' },
  { key: '2026-R18', start: '2026-07-09', end: '2026-07-13' },
  { key: '2026-R19', start: '2026-07-16', end: '2026-07-20' },
  { key: '2026-R20', start: '2026-07-23', end: '2026-07-27' },
  { key: '2026-R21', start: '2026-07-30', end: '2026-08-03' },
  { key: '2026-R22', start: '2026-08-06', end: '2026-08-10' },
  { key: '2026-R23', start: '2026-08-13', end: '2026-08-17' },
];

function calendarRoundKeyFromCommenceTime(commenceTime) {
  const date = String(commenceTime || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  for (const window of AFL_2026_ROUND_WINDOWS) {
    if (date >= window.start && date <= window.end) return window.key;
  }
  return null;
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

function isDateInAflRoundWindow(date, bounds) {
  if (date >= bounds.min && date <= bounds.max) return true;
  if (date < bounds.min) return false;
  const maxMs = Date.parse(bounds.max);
  const dateMs = Date.parse(date);
  const minMs = Date.parse(bounds.min);
  if (!Number.isFinite(maxMs) || !Number.isFinite(dateMs) || !Number.isFinite(minMs)) return false;
  const daysAfterMax = (dateMs - maxMs) / 86_400_000;
  const roundSpanDays = (maxMs - minMs) / 86_400_000;
  return daysAfterMax >= 0 && daysAfterMax <= 4 && roundSpanDays <= 7;
}

function inferRoundKey(commenceTime, records) {
  if (!commenceTime) return null;
  const calendarKey = calendarRoundKeyFromCommenceTime(commenceTime);
  if (calendarKey) return calendarKey;
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
    if (isDateInAflRoundWindow(date, bounds)) return roundKey;
  }
  return null;
}

function mergePicks(primaryPicks, secondaryPicks) {
  if (!Array.isArray(primaryPicks) || primaryPicks.length === 0) {
    return Array.isArray(secondaryPicks) ? secondaryPicks : [];
  }
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

function rankedFallbackRows(rows) {
  return [...rows]
    .filter((row) => parseNumber(row.expectedDisposals) != null && parseNumber(row.line) != null)
    .sort((a, b) => {
      const edgeA =
        parseNumber(a.edgeVsMarket) != null
          ? Math.abs(parseNumber(a.edgeVsMarket))
          : Math.abs(parseNumber(a.expectedDisposals) - parseNumber(a.line));
      const edgeB =
        parseNumber(b.edgeVsMarket) != null
          ? Math.abs(parseNumber(b.edgeVsMarket))
          : Math.abs(parseNumber(b.expectedDisposals) - parseNumber(b.line));
      if (edgeA !== edgeB) return edgeB - edgeA;
      return String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
    });
}

function selectFallbackTopRows(gameRows, limitPerGame = 3) {
  const cap = Math.max(1, Math.min(10, limitPerGame));
  const maxSame = 2;
  const seen = new Set();
  let overCount = 0;
  let underCount = 0;
  const selected = [];
  for (const row of rankedFallbackRows(gameRows)) {
    if (selected.length >= cap) break;
    const playerKey = String(row.playerName ?? '').trim().toLowerCase();
    if (!playerKey || seen.has(playerKey)) continue;
    const side =
      normalizeSide(row.recommendedSide) ??
      (parseNumber(row.expectedDisposals) - parseNumber(row.line) >= 0 ? 'OVER' : 'UNDER');
    if (side !== 'OVER' && side !== 'UNDER') continue;
    if (side === 'OVER' && overCount >= maxSame) continue;
    if (side === 'UNDER' && underCount >= maxSame) continue;
    seen.add(playerKey);
    if (side === 'OVER') overCount += 1;
    else underCount += 1;
    selected.push({ ...row, recommendedSide: side });
  }
  return selected;
}

function mapTopPickRows(selected) {
  if (selected.length === 0) return null;
  const first = selected[0];
  return {
    gameKey: String(first.gameKey ?? '').trim(),
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
  };
}

function getTopPicksByGame(payload, limitPerGame = 3) {
  const rows = payload?.rows ?? [];
  const byGame = new Map();
  for (const row of rows) {
    const gameKey = String(row.gameKey ?? '').trim();
    if (!gameKey) continue;
    const list = byGame.get(gameKey);
    if (list) list.push(row);
    else byGame.set(gameKey, [row]);
  }
  const out = new Map();
  for (const [gameKey, gameRows] of byGame.entries()) {
    const flagged = gameRows
      .filter((row) => row.isTop3PickInGame)
      .sort(
        (a, b) =>
          (parseNumber(a.recommendedPlayerRankInGame) ?? 999) - (parseNumber(b.recommendedPlayerRankInGame) ?? 999)
      )
      .slice(0, limitPerGame);
    const selected = flagged.length > 0 ? flagged : selectFallbackTopRows(gameRows, limitPerGame);
    const mapped = mapTopPickRows(selected);
    if (mapped) out.set(gameKey, mapped);
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

const BRISBANE_TZ = 'Australia/Brisbane';
/** From Collingwood vs Suns onward, snapshot batching may add live picks; earlier games stay on locked history. */
const LIVE_UPDATES_FROM_COMMENCE = '2026-07-04T06:15:12Z';

function allowsLivePickUpdates(commenceTime) {
  if (!commenceTime) return true;
  const kickoff = Date.parse(String(commenceTime));
  const cutoff = Date.parse(LIVE_UPDATES_FROM_COMMENCE);
  if (!Number.isFinite(kickoff) || !Number.isFinite(cutoff)) return true;
  return kickoff >= cutoff;
}

function brisbaneYmd(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRISBANE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map((part) => Number.parseInt(part, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dayOfWeekYmd(ymd) {
  const [y, m, d] = ymd.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function gameDateBrisbane(commenceTime) {
  if (!commenceTime) return null;
  const parsed = new Date(commenceTime);
  if (!Number.isNaN(parsed.getTime())) return brisbaneYmd(parsed);
  const slice = String(commenceTime).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : null;
}

function thursdayBlockForDate(gameDate) {
  const dow = dayOfWeekYmd(gameDate);
  const offsetByDow = { 0: -3, 1: -4, 2: -5, 3: -6, 4: 0, 5: -1, 6: -2 };
  const thursday = addDaysYmd(gameDate, offsetByDow[dow] ?? 0);
  return { min: thursday, max: addDaysYmd(thursday, 4) };
}

function isDateInRoundWindow(date, window) {
  return date >= window.min && date <= window.max;
}

function isPastGame(game, now) {
  const kickoffMs = game.commenceTime ? Date.parse(game.commenceTime) : Number.NaN;
  return Number.isFinite(kickoffMs) && kickoffMs < now.getTime();
}

/** When any game enters the pre-bounce window, lock picks for all upcoming games in the same Thu–Mon round block. */
function collectRoundLockGameKeys(games, eligibleKeys, existingByGame, now, force) {
  const lockKeys = new Set();
  for (const gameKey of eligibleKeys) {
    const game = games.get(gameKey);
    if (!game) continue;
    const anchorDate = gameDateBrisbane(game.commenceTime);
    if (!anchorDate) continue;
    const block = thursdayBlockForDate(anchorDate);
    for (const [gk, g] of games.entries()) {
      if (isPastGame(g, now)) continue;
      const gd = gameDateBrisbane(g.commenceTime);
      if (!gd || !isDateInRoundWindow(gd, block)) continue;
      const existing = existingByGame.get(gk);
      if (existing && !force) continue;
      if (!allowsLivePickUpdates(g.commenceTime) && !existing) continue;
      lockKeys.add(gk);
    }
  }
  return lockKeys;
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

  const eligibleKeys = new Set();
  for (const game of games.values()) {
    if (isPastGame(game, args.now)) continue;
    if (!isWithinFinalizeWindow(game.commenceTime, args.now, args.windowHours)) continue;
    eligibleKeys.add(game.gameKey);
  }
  eligible = eligibleKeys.size;

  const keysToSnapshot = collectRoundLockGameKeys(games, eligibleKeys, existingByGame, args.now, args.force);

  for (const gameKey of keysToSnapshot) {
    const game = games.get(gameKey);
    if (!game) continue;
    if (isPastGame(game, args.now)) continue;
    const existing = existingByGame.get(gameKey);
    if (existing && !args.force) {
      skippedFinalized += 1;
      continue;
    }
    const picks = topPicksByGame.get(gameKey)?.picks ?? [];
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
      `roundLock=${keysToSnapshot.size}`,
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

function normalizePlayerName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

function gameLogPlayerName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === 'Cam Mackenzie') return 'Cameron Mackenzie';
  return trimmed;
}

function gameDateFromCommence(commenceTime) {
  if (!commenceTime) return '';
  const parsed = new Date(commenceTime);
  if (Number.isNaN(parsed.getTime())) return String(commenceTime).slice(0, 10);
  return brisbaneYmd(parsed);
}

const PLAYER_LOG_CACHE_DIRS = [
  path.join(ROOT, 'data', 'afl-model', 'cache', 'player-logs'),
  path.join(ROOT, 'data', 'afl-model', 'afl-model', 'cache', 'player-logs'),
  path.join(ROOT, 'data', 'afl-model', 'afl-model', 'afl-model', 'cache', 'player-logs'),
];

function parseYmd(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return Date.UTC(y, m - 1, d);
}

function gameRowDate(game) {
  return String(game?.date ?? game?.gameDate ?? game?.game_date ?? '').slice(0, 10);
}

function matchGame(gameDate, games) {
  const exact = games.find((game) => gameRowDate(game) === gameDate);
  if (exact) return exact;
  const rowDateMs = parseYmd(gameDate);
  if (rowDateMs == null) return null;
  let best = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const game of games) {
    const gameMs = parseYmd(gameRowDate(game));
    if (gameMs == null) continue;
    const diff = Math.abs(gameMs - rowDateMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = game;
    }
  }
  return bestDiff <= 24 * 60 * 60 * 1000 ? best : null;
}

function mergeGames(...lists) {
  const byDate = new Map();
  for (const list of lists) {
    for (const game of list ?? []) {
      const date = gameRowDate(game);
      if (!date) continue;
      byDate.set(date, game);
    }
  }
  return [...byDate.values()];
}

function loadLocalPlayerGames(season, playerName) {
  const needle = `_${normalizePlayerName(playerName).replace(/\s+/g, '_')}_`;
  const prefix = `${season}`;
  const games = [];
  for (const cacheDir of PLAYER_LOG_CACHE_DIRS) {
    if (!fs.existsSync(cacheDir)) continue;
    for (const fileName of fs.readdirSync(cacheDir)) {
      if (!fileName.startsWith(prefix) || !fileName.includes(needle) || !fileName.endsWith('.json')) continue;
      try {
        const payload = readJsonFileAnyEncoding(path.join(cacheDir, fileName));
        const rows = Array.isArray(payload?.games) ? payload.games : [];
        games.push(...rows);
      } catch {
        // Ignore malformed cache files.
      }
    }
  }
  return mergeGames(games);
}

async function fetchPlayerGames(baseUrl, season, playerName, { forceFetch = false, team = null, cronSecret = '' } = {}) {
  const params = new URLSearchParams({
    season: String(season),
    player_name: playerName,
    include_both: '1',
  });
  if (team) params.set('team', team);
  if (forceFetch) params.set('force_fetch', '1');
  const headers = { cache: 'no-store' };
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
    headers['x-cron-secret'] = cronSecret;
  }
  const controller = new AbortController();
  const timeoutMs = forceFetch ? 45000 : 15000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/afl/player-game-logs?${params.toString()}`, {
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.games) ? data.games : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function loadLeagueTeamByPlayerName() {
  const lookup = new Map();
  const dataDir = path.join(ROOT, 'data');
  if (!fs.existsSync(dataDir)) return lookup;
  const files = fs
    .readdirSync(dataDir)
    .filter((name) => /^afl-league-player-stats-\d+\.json$/i.test(name))
    .sort()
    .reverse();
  for (const fileName of files) {
    try {
      const payload = readJsonFileAnyEncoding(path.join(dataDir, fileName));
      const players = Array.isArray(payload?.players) ? payload.players : [];
      for (const player of players) {
        const name = String(player?.name ?? '').trim();
        const team = String(player?.team ?? '').trim();
        if (!name || !team) continue;
        const key = normalizePlayerName(name);
        if (!lookup.has(key)) lookup.set(key, team);
      }
      if (lookup.size > 0) break;
    } catch {
      // Try next snapshot.
    }
  }
  return lookup;
}

function buildLineHistoryActualLookup() {
  const lookup = new Map();
  if (!fs.existsSync(LINE_HISTORY_PATH)) return lookup;
  try {
    const payload = readJsonFileAnyEncoding(LINE_HISTORY_PATH);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    for (const row of rows) {
      if (typeof row.actualDisposals !== 'number' || !Number.isFinite(row.actualDisposals)) continue;
      const player = normalizePlayerName(row.playerName);
      const gameDate = String(row.gameDate ?? row.commenceTime ?? '').slice(0, 10);
      if (!player || !gameDate) continue;
      const home = normalizeTeam(row.homeTeam);
      const away = normalizeTeam(row.awayTeam);
      lookup.set(`${player}|${gameDate}|${home}|${away}`, row.actualDisposals);
      lookup.set(`${player}|${gameDate}|${away}|${home}`, row.actualDisposals);
      if (!lookup.has(`${player}|${gameDate}`)) lookup.set(`${player}|${gameDate}`, row.actualDisposals);
    }
  } catch {
    // Ignore malformed line history.
  }
  return lookup;
}

function lookupLineHistoryActual(pick, record, lineHistoryLookup) {
  const player = normalizePlayerName(gameLogPlayerName(pick.playerName));
  const gameDate = gameDateFromCommence(record?.commenceTime);
  if (!player || !gameDate) return null;
  const home = normalizeTeam(record.homeTeam);
  const away = normalizeTeam(record.awayTeam);
  const exact =
    lineHistoryLookup.get(`${player}|${gameDate}|${home}|${away}`) ??
    lineHistoryLookup.get(`${player}|${gameDate}|${away}|${home}`);
  if (typeof exact === 'number' && Number.isFinite(exact)) return exact;
  const fallback = lineHistoryLookup.get(`${player}|${gameDate}`);
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
}

function teamCandidatesForPick(record, pick, leagueTeamByPlayer) {
  const candidates = [];
  const fromLeague = leagueTeamByPlayer.get(normalizePlayerName(gameLogPlayerName(pick.playerName)));
  if (fromLeague) candidates.push(fromLeague);
  if (record?.homeTeam) candidates.push(String(record.homeTeam));
  if (record?.awayTeam) candidates.push(String(record.awayTeam));
  return [...new Set(candidates.filter(Boolean))];
}

async function resolvePlayerGames(baseUrl, season, playerName, gameDate, logsCache, teamCandidates, cronSecret) {
  const cacheKey = `${season}|${normalizePlayerName(playerName)}`;
  if (logsCache.has(cacheKey)) return logsCache.get(cacheKey);

  const localGames = loadLocalPlayerGames(season, playerName);
  const teams = teamCandidates.length > 0 ? teamCandidates : [null];
  let games = [...localGames];
  for (const team of teams) {
    games = mergeGames(games, await fetchPlayerGames(baseUrl, season, playerName, { team, cronSecret }));
    if (matchGame(gameDate, games)) break;
  }
  if (!matchGame(gameDate, games)) {
    games = mergeGames(
      games,
      await fetchPlayerGames(baseUrl, season, playerName, {
        forceFetch: true,
        team: teams[0] ?? null,
        cronSecret,
      })
    );
  }
  logsCache.set(cacheKey, games);
  return games;
}

async function runEnrich(args) {
  if (!fs.existsSync(HISTORY_PATH)) {
    console.log('[afl-top-picks-enrich] no history file');
    return;
  }

  const cronSecret = String(process.env.CRON_SECRET ?? '').trim();
  const leagueTeamByPlayer = loadLeagueTeamByPlayerName();
  const lineHistoryLookup = buildLineHistoryActualLookup();
  const payload = readJsonFileAnyEncoding(HISTORY_PATH);
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const todayIso = brisbaneYmd(new Date());
  const logsCache = new Map();
  const altSourceCache = new Map();
  let updatedPicks = 0;
  let fromLineHistory = 0;
  let fromApi = 0;
  let fromAltSource = 0;
  let clearedPremature = 0;
  let missingMatch = 0;

  for (const record of records) {
    if (!record.roundKey) {
      record.roundKey = inferRoundKey(record.commenceTime, records);
    }
    const gameDate = gameDateFromCommence(record?.commenceTime);
    if (!gameDate || gameDate > todayIso) continue;
    const kickoffMs = Date.parse(String(record?.commenceTime ?? ''));
    // Don't chase actuals before bounce — Wheeloratings/ESPN won't have a box score yet.
    if (Number.isFinite(kickoffMs) && kickoffMs > Date.now()) continue;
    const season = Number.parseInt(gameDate.slice(0, 4), 10);
    const gameFinal = await isAflGameFinalOnEspn(
      {
        homeTeam: record.homeTeam,
        awayTeam: record.awayTeam,
        gameDate,
      },
      altSourceCache
    );

    // Live box scores must never settle Top Picks. Clear any premature totals.
    if (!gameFinal) {
      for (const pick of record.picks ?? []) {
        if (typeof pick.actualDisposals === 'number' && Number.isFinite(pick.actualDisposals)) {
          pick.actualDisposals = null;
          clearedPremature += 1;
          updatedPicks += 1;
        }
      }
      continue;
    }

    for (const pick of record.picks ?? []) {
      const existingActual =
        typeof pick.actualDisposals === 'number' && Number.isFinite(pick.actualDisposals)
          ? pick.actualDisposals
          : null;

      // Always prefer a fresh final box score so mid-game values can be corrected.
      const alt = await lookupTopPicksActualFromAltSources(
        {
          playerName: pick.playerName,
          homeTeam: record.homeTeam,
          awayTeam: record.awayTeam,
          gameDate,
          roundKey: record.roundKey,
        },
        altSourceCache
      );
      if (alt?.actual != null) {
        if (existingActual !== alt.actual) {
          pick.actualDisposals = alt.actual;
          updatedPicks += 1;
          fromAltSource += 1;
        }
        continue;
      }

      if (existingActual != null) continue;

      const fromHistory = lookupLineHistoryActual(pick, record, lineHistoryLookup);
      if (fromHistory != null) {
        pick.actualDisposals = fromHistory;
        updatedPicks += 1;
        fromLineHistory += 1;
        continue;
      }
      const lookupName = gameLogPlayerName(pick.playerName);
      const teams = teamCandidatesForPick(record, pick, leagueTeamByPlayer);
      const games = await resolvePlayerGames(
        args.baseUrl,
        season,
        lookupName,
        gameDate,
        logsCache,
        teams,
        cronSecret
      );
      const match = matchGame(gameDate, games);
      if (match) {
        const actual =
          typeof match.disposals === 'number' ? match.disposals : Number.parseFloat(String(match.disposals ?? ''));
        if (Number.isFinite(actual)) {
          pick.actualDisposals = actual;
          updatedPicks += 1;
          fromApi += 1;
          continue;
        }
      }

      missingMatch += 1;
    }
  }

  console.log(
    `[afl-top-picks-enrich] updatedPicks=${updatedPicks} fromLineHistory=${fromLineHistory} fromApi=${fromApi} fromAltSource=${fromAltSource} clearedPremature=${clearedPremature} missingMatch=${missingMatch} dryRun=${args.dryRun}`
  );
  if (updatedPicks > 0 && !args.dryRun) {
    writeUtf8(
      HISTORY_PATH,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), count: records.length, records }, null, 2)}\n`
    );
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.snapshot) {
  runSnapshot(args);
} else if (args.enrich) {
  runEnrich(args).catch((error) => {
    console.error('[afl-top-picks-enrich] failed', error);
    process.exit(1);
  });
} else {
  runBackfill(args);
}
