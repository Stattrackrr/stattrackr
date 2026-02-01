export const dynamic = 'force-dynamic';
export const maxDuration = 600; // 10 min to scan all props (~1250+)

/**
 * Daily Pick API
 * Scans ALL props (player props, game props) from cache and returns
 * the single best read for the day - whichever prop has the strongest signal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache } from '@/lib/nbaCache';
import cache from '@/lib/cache';
import type { OddsCache } from '@/app/api/odds/refresh/route';
import { PLAYER_ID_MAPPINGS } from '@/lib/playerIdMapping';
import { runPredictionForProp, type PropInput, type BookmakerLine } from '@/lib/prediction-engine/runPrediction';

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const MIN_DECIMAL_ODDS = 1.65;

/** Convert American odds to decimal (e.g. -110 → 1.91, +150 → 2.5) */
function americanToDecimal(american: string | number): number {
  const num = typeof american === 'number' ? american : parseInt(String(american).replace(/[^0-9+-]/g, ''), 10);
  if (isNaN(num)) return 0;
  return num > 0 ? num / 100 + 1 : 100 / Math.abs(num) + 1;
}

/** Find best bookmaker for direction with odds >= minDecimal. Returns { bookmaker, overOdds, underOdds } or null. */
function findBestBookmakerForDirection(
  bookmakerLines: BookmakerLine[],
  direction: 'OVER' | 'UNDER',
  minDecimal: number
): { bookmaker: string; overOdds: string; underOdds: string } | null {
  if (!bookmakerLines?.length) return null;
  let best: { bookmaker: string; overOdds: string; underOdds: string; decimal: number } | null = null;
  for (const bl of bookmakerLines) {
    const oddsStr = direction === 'OVER' ? bl.overOdds : bl.underOdds;
    const dec = americanToDecimal(oddsStr);
    if (dec >= minDecimal && (!best || dec > best.decimal)) {
      best = { bookmaker: bl.bookmaker, overOdds: bl.overOdds, underOdds: bl.underOdds, decimal: dec };
    }
  }
  return best ? { bookmaker: best.bookmaker, overOdds: best.overOdds, underOdds: best.underOdds } : null;
}
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props';

function getUSEasternDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    });
}

function getGameDateFromOddsCache(oddsCache: OddsCache): string {
  const todayUSET = getUSEasternDateString(new Date());
  if (!oddsCache.games || oddsCache.games.length === 0) return todayUSET;

  const gameDates = new Set<string>();
  for (const game of oddsCache.games) {
    if (!game.commenceTime) continue;
    const commenceStr = String(game.commenceTime).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDates.add(commenceStr);
    } else {
      const date = new Date(commenceStr);
      gameDates.add(getUSEasternDateString(date));
    }
  }

  if (gameDates.has(todayUSET)) return todayUSET;
  return Array.from(gameDates).sort()[0] || todayUSET;
}

async function loadAllPlayerProps(gameDate: string): Promise<any[]> {
  const part1Key = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates-part1`;
  const part2Key = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates-part2`;
  const part3Key = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates-part3`;
  const allDatesKey = `${PLAYER_PROPS_CACHE_PREFIX}-all-dates`;
  const dateKey = `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}`;

  const cacheOptions = { restTimeoutMs: 20000, jsTimeoutMs: 20000, quiet: true };

  let parts: any[] = [];
  for (const key of [part1Key, part2Key, part3Key]) {
    let data = await getNBACache<any>(key, cacheOptions);
    if (!data) data = cache.get<any>(key);
    if (data && Array.isArray(data)) parts = parts.concat(data);
  }

  if (parts.length === 0) {
    let data = await getNBACache<any>(allDatesKey, cacheOptions);
    if (!data) data = cache.get<any>(allDatesKey);
    if (data && Array.isArray(data)) parts = data;
  }

  if (parts.length === 0) {
    let data = await getNBACache<any>(dateKey, cacheOptions);
    if (!data) data = cache.get<any>(dateKey);
    if (data && Array.isArray(data)) parts = data;
  }

  if (parts.length === 0) return [];

  return parts;
}

/**
 * Filter props to only those from today's upcoming games (in odds cache)
 * and that have valid odds
 */
function filterPropsForToday(
  rawProps: any[],
  oddsCache: OddsCache,
  _gameDate: string
): any[] {
  const validGameDates = new Set<string>();
  const gameCommenceTimes = new Set<string>();
  const now = Date.now();
  for (const game of oddsCache.games || []) {
    if (!game.commenceTime) continue;
    const commenceStr = String(game.commenceTime).trim();
    if (commenceStr.length > 10) {
      const gameTime = new Date(commenceStr).getTime();
      if (!isNaN(gameTime) && gameTime < now - 60 * 60 * 1000) continue;
    }
    gameCommenceTimes.add(commenceStr);
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      validGameDates.add(commenceStr);
    } else {
      try {
        const d = new Date(commenceStr);
        if (!isNaN(d.getTime())) {
          validGameDates.add(getUSEasternDateString(d));
        }
      } catch {
        /* ignore */
      }
    }
  }

  const hasValidOdds = (p: any): boolean => {
    const over = p.overOdds ?? p.bookmakerLines?.[0]?.overOdds;
    const under = p.underOdds ?? p.bookmakerLines?.[0]?.underOdds;
    if (!over || !under || over === 'N/A' || under === 'N/A') return false;
    const overNum = parseInt(String(over).replace(/[^0-9+-]/g, ''), 10);
    const underNum = parseInt(String(under).replace(/[^0-9+-]/g, ''), 10);
    return !isNaN(overNum) && !isNaN(underNum);
  };

  const hasEnoughBookmakers = (p: any): boolean => {
    const lines = p.bookmakerLines;
    if (!lines || !Array.isArray(lines)) return false;
    const uniqueBooks = new Set(lines.map((l: any) => l?.bookmaker).filter(Boolean));
    return uniqueBooks.size >= 2;
  };

  const byKey = new Map<string, any>();
  for (const p of rawProps) {
    if (!p.playerName || !p.statType || p.line == null) continue;
    if (!hasValidOdds(p)) continue;
    if (!hasEnoughBookmakers(p)) continue;

    const propGameDate = String(p.gameDate || '').trim();
    const propDateMatch = propGameDate.match(/^(\d{4}-\d{2}-\d{2})/);
    const propDateOnly = propDateMatch ? propDateMatch[1] : propGameDate;

    const isTodayGame =
      validGameDates.has(propDateOnly) ||
      validGameDates.has(propGameDate) ||
      gameCommenceTimes.has(propGameDate);
    if (!isTodayGame) continue;

    const key = `${p.playerName}|${p.statType}|${Math.round(parseFloat(p.line) * 2) / 2}`;
    const existing = byKey.get(key);
    if (existing) {
      // Merge bookmakerLines so we see every line from every bookmaker
      const seenB = new Set((existing.bookmakerLines || []).map((l: any) => `${l?.bookmaker}|${l?.line}`));
      const existingLines = existing.bookmakerLines || [];
      for (const bl of p.bookmakerLines || []) {
        const bkey = `${bl?.bookmaker}|${bl?.line}`;
        if (!seenB.has(bkey)) {
          seenB.add(bkey);
          existingLines.push(bl);
        }
      }
      existing.bookmakerLines = existingLines;
    } else {
      byKey.set(key, { ...p });
    }
  }

  return Array.from(byKey.values());
}

function getPlayerId(playerName: string): number | null {
  const mapping = PLAYER_ID_MAPPINGS.find(
    (m) =>
      m.name.toLowerCase() === playerName.toLowerCase() ||
      m.name.toLowerCase().includes(playerName.toLowerCase()) ||
      playerName.toLowerCase().includes(m.name.toLowerCase())
  );
  const bdlId = mapping?.bdlId;
  return bdlId ? parseInt(String(bdlId), 10) : null;
}

/** Run predictions with concurrency limit */
async function runPredictionsWithLimit(
  props: PropInput[],
  concurrency: number,
  maxProps: number,
  onProgress?: (done: number, total: number) => void
): Promise<Awaited<ReturnType<typeof runPredictionForProp>>[]> {
  const toProcess = props.slice(0, maxProps);
  const results: Awaited<ReturnType<typeof runPredictionForProp>>[] = [];
  let nextIdx = 0;

  async function processNext(): Promise<void> {
    const idx = nextIdx++;
    if (idx >= toProcess.length) return;

    const prop = toProcess[idx];
    const result = await runPredictionForProp(prop);
    results.push(result);
    onProgress?.(results.length, toProcess.length);

    await processNext(); // Continue with next
  }

  const workers = Array(Math.min(concurrency, toProcess.length))
    .fill(null)
    .map(() => processNext());
  await Promise.all(workers);

  return results;
}

export async function GET(request: NextRequest) {
  try {
    console.log('[Daily Pick] Starting scan...');

    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 15000,
      jsTimeoutMs: 15000,
      quiet: true,
    });
    if (!oddsCache) {
      oddsCache = cache.get<OddsCache>(ODDS_CACHE_KEY);
    }

    if (!oddsCache || !oddsCache.games?.length) {
      return NextResponse.json({
        success: false,
        error: 'No odds data - cache may be refreshing',
        dailyPick: null,
      }, { status: 503 });
    }

    const gameDate = getGameDateFromOddsCache(oddsCache);
    const rawProps = await loadAllPlayerProps(gameDate);

    const filteredProps = filterPropsForToday(rawProps, oddsCache, gameDate);

    if (filteredProps.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No props for today\'s upcoming games with 2+ bookmakers and valid odds',
        dailyPick: null,
        hint: rawProps.length > 0
          ? `${rawProps.length} props in cache but none have 2+ bookmakers and match today\'s games`
          : undefined,
      }, { status: 503 });
    }

    // One PropInput per prop; include ALL bookmakerLines for odds filtering (>= 1.65)
    const propsToScan: PropInput[] = [];
    for (const p of filteredProps) {
      const playerId = p.playerId ? parseInt(String(p.playerId), 10) : getPlayerId(p.playerName);
      if (!playerId || isNaN(playerId)) continue;

      const line = typeof p.line === 'number' ? p.line : parseFloat(p.line);
      if (isNaN(line)) continue;

      const bookmakerLines = (p.bookmakerLines || []).map((l: any) => ({
        bookmaker: l?.bookmaker || 'Unknown',
        line: typeof l?.line === 'number' ? l.line : parseFloat(l?.line) || line,
        overOdds: String(l?.overOdds ?? '-110'),
        underOdds: String(l?.underOdds ?? '-110'),
      }));
      const firstLine = bookmakerLines[0];
      const overOdds = firstLine?.overOdds ?? p.overOdds ?? '-110';
      const underOdds = firstLine?.underOdds ?? p.underOdds ?? '-110';
      const bookmakerCount = new Set(bookmakerLines.map((l: { bookmaker: string }) => l.bookmaker)).size;

      propsToScan.push({
        playerId,
        playerName: p.playerName,
        team: p.team || 'UNK',
        opponent: p.opponent || '',
        statType: p.statType,
        line,
        overOdds,
        underOdds,
        gameDate: p.gameDate || gameDate,
        bookmaker: firstLine?.bookmaker || p.bookmaker || p.bookmakerLines?.[0]?.bookmaker,
        bookmakerCount,
        bookmakerLines: bookmakerLines.length > 0 ? bookmakerLines : undefined,
      });
    }

    if (propsToScan.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No props with valid player IDs',
        dailyPick: null,
      }, { status: 503 });
    }

    const CONCURRENCY = 8;

    console.log(`[Daily Pick] Scanning all ${propsToScan.length} props (odds >= ${MIN_DECIMAL_ODDS})...`);

    const results = await runPredictionsWithLimit(
      propsToScan,
      CONCURRENCY,
      propsToScan.length, // Scan every single prop
      (done, total) => {
        if (done % 50 === 0 || done === total) {
          console.log(`[Daily Pick] Progress: ${done}/${total}`);
        }
      }
    );

    const successful = results.filter((r) => r.success && r.result && r.readScore != null);

    // Filter: no PASS, odds >= 1.65 — no confidence threshold, show highest-confidence bet
    const direction = (r: typeof successful[0]) => ((r.result!.edge ?? 0) > 0 ? 'OVER' : 'UNDER') as 'OVER' | 'UNDER';
    const eligible = successful.filter((r) => {
      if (r.result!.recommendation === 'PASS') return false;
      const lines = r.prop.bookmakerLines;
      const dir = direction(r);
      const best = findBestBookmakerForDirection(lines || [], dir, MIN_DECIMAL_ODDS);
      return !!best;
    });

    if (eligible.length === 0) {
      const passCount = successful.filter((r) => r.result!.recommendation === 'PASS').length;
      const lowOddsCount = successful.filter((r) => {
        if (r.result!.recommendation === 'PASS') return false;
        const best = findBestBookmakerForDirection(r.prop.bookmakerLines || [], direction(r), MIN_DECIMAL_ODDS);
        return !best;
      }).length;
      return NextResponse.json({
        success: false,
        error: `No eligible picks (odds ≥${MIN_DECIMAL_ODDS}): ${passCount} PASS, ${lowOddsCount} low odds`,
        scanned: results.length,
        dailyPick: null,
      }, { status: 200 });
    }

    // Sort by read score (best first)
    eligible.sort((a, b) => (b.readScore ?? 0) - (a.readScore ?? 0));
    const best = eligible[0];
    const bestDir = direction(best);
    const bestBookmaker = findBestBookmakerForDirection(best.prop.bookmakerLines || [], bestDir, MIN_DECIMAL_ODDS)!;

    const dailyPick = {
      type: 'player' as const,
      prop: {
        ...best.prop,
        bookmaker: bestBookmaker.bookmaker,
        overOdds: bestBookmaker.overOdds,
        underOdds: bestBookmaker.underOdds,
      },
      result: best.result,
      readScore: best.readScore,
      direction: bestDir,
      scanned: results.length,
      successful: eligible.length,
    };

    console.log(`[Daily Pick] Best read:`, {
      player: dailyPick.prop.playerName,
      stat: dailyPick.prop.statType,
      line: dailyPick.prop.line,
      direction: dailyPick.direction,
      edge: dailyPick.result?.edge,
      confidence: dailyPick.result?.confidence,
      readScore: dailyPick.readScore,
    });

    return NextResponse.json({
      success: true,
      dailyPick,
      gameDate,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Daily Pick] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to generate daily pick',
      dailyPick: null,
    }, { status: 500 });
  }
}
