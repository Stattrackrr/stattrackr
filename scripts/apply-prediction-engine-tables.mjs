import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HISTORY_PATH = path.join(ROOT, 'data', 'afl-model', 'history', 'top-picks-history.json');

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
  return {
    file: argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length) ?? null,
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
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

const args = parseArgs(process.argv.slice(2));
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
