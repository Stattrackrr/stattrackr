import { headers } from 'next/headers';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';

const NBA_INLINE_PAYLOAD_MAX_CHARS = 250_000;
const AFL_INLINE_PAYLOAD_MAX_CHARS = 900_000;
const NBA_PROPS_CACHE_KEY = 'nba-player-props-cache';
const NBA_PROPS_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
const AFL_PROPS_CACHE_KEY = 'afl_props_list_cache_v1';
const CACHE_STALE_MS = 30 * 60 * 1000;

type NbaPropsResponse = {
  success?: boolean;
  data?: unknown[];
};

type AflListResponse = {
  success?: boolean;
  data?: AflListRow[];
  games?: AflGame[];
};

type AflGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};

type AflListRow = {
  playerName: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  playerTeam?: string | null;
  statType: string;
  line: number;
  bookmaker: string;
  overOdds?: string | null;
  underOdds?: string | null;
  commenceTime?: string;
  last5Avg?: number | null;
  last10Avg?: number | null;
  h2hAvg?: number | null;
  seasonAvg?: number | null;
  streak?: number | null;
  last5HitRate?: { hits: number; total: number } | null;
  last10HitRate?: { hits: number; total: number } | null;
  h2hHitRate?: { hits: number; total: number } | null;
  seasonHitRate?: { hits: number; total: number } | null;
  dvpRating?: number | null;
  dvpStatValue?: number | null;
};

function buildAflCachePayload(listData: AflListResponse) {
  const games = Array.isArray(listData.games) ? listData.games : [];
  const rows = Array.isArray(listData.data) ? listData.data : [];
  if (rows.length === 0 && games.length === 0) return null;

  const keyToRow = new Map<
    string,
    AflListRow & { bookmakerLines: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }> }
  >();

  for (const r of rows) {
    const key = `${r.playerName}|${r.gameId}|${r.statType}|${r.line}`;
    const existing = keyToRow.get(key);
    const bookmakerLine = {
      bookmaker: r.bookmaker,
      line: r.line,
      overOdds: r.overOdds || 'N/A',
      underOdds: r.underOdds || 'N/A',
    };
    if (existing) {
      existing.bookmakerLines.push(bookmakerLine);
    } else {
      keyToRow.set(key, {
        ...r,
        commenceTime: r.commenceTime || '',
        bookmakerLines: [bookmakerLine],
      });
    }
  }

  const props = Array.from(keyToRow.values()).map((r) => {
    const playerTeam = r.playerTeam && String(r.playerTeam).trim() ? r.playerTeam : null;
    const homeNorm = toOfficialAflTeamDisplayName(r.homeTeam || '');
    const awayNorm = toOfficialAflTeamDisplayName(r.awayTeam || '');
    const playerNorm = playerTeam ? toOfficialAflTeamDisplayName(playerTeam) : null;
    const team = playerNorm || homeNorm;
    const opponent = playerNorm
      ? (playerNorm === homeNorm ? awayNorm : playerNorm === awayNorm ? homeNorm : awayNorm)
      : awayNorm;

    return {
      playerName: r.playerName,
      playerId: '',
      team,
      opponent,
      statType: r.statType,
      line: r.line,
      overProb: 0,
      underProb: 0,
      overOdds: r.bookmakerLines[0]?.overOdds ?? 'N/A',
      underOdds: r.bookmakerLines[0]?.underOdds ?? 'N/A',
      impliedOverProb: 0,
      impliedUnderProb: 0,
      bestLine: r.line,
      bookmaker: r.bookmakerLines[0]?.bookmaker ?? '',
      confidence: 'Medium',
      gameDate: r.commenceTime || '',
      bookmakerLines: r.bookmakerLines,
      gameId: r.gameId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      last5Avg: r.last5Avg,
      last10Avg: r.last10Avg,
      h2hAvg: r.h2hAvg,
      seasonAvg: r.seasonAvg,
      streak: r.streak,
      last5HitRate: r.last5HitRate,
      last10HitRate: r.last10HitRate,
      h2hHitRate: r.h2hHitRate,
      seasonHitRate: r.seasonHitRate,
      dvpRating: r.dvpRating,
      dvpStatValue: r.dvpStatValue,
    };
  });

  return {
    props,
    games,
    selectedGameIds: games.length > 0 ? games.map((g) => g.gameId) : [],
  };
}

function escapeForInlineScript(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'force-cache',
      next: { revalidate: 60 },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function PropsLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';

  const inlineSeedScriptChunks: string[] = [];

  if (host) {
    const baseUrl = `${proto}://${host}`;
    const [nbaData, aflData] = await Promise.all([
      fetchJsonWithTimeout<NbaPropsResponse>(`${baseUrl}/api/nba/player-props`, 1500),
      fetchJsonWithTimeout<AflListResponse>(`${baseUrl}/api/afl/player-props/list`, 2000),
    ]);

    const propsRows = Array.isArray(nbaData?.data) ? nbaData.data : [];

    if ((nbaData?.success ?? false) && propsRows.length > 0) {
      const serialized = JSON.stringify(propsRows);
      if (serialized.length <= NBA_INLINE_PAYLOAD_MAX_CHARS) {
        const escaped = escapeForInlineScript(serialized);
        inlineSeedScriptChunks.push(`
          (function(){
            try {
              var now = Date.now();
              var tsRaw = sessionStorage.getItem('${NBA_PROPS_TIMESTAMP_KEY}');
              var ts = tsRaw ? parseInt(tsRaw, 10) : 0;
              var isFresh = Number.isFinite(ts) && (now - ts) < ${CACHE_STALE_MS};
              if (!isFresh) {
                sessionStorage.setItem('${NBA_PROPS_CACHE_KEY}', '${escaped}');
                sessionStorage.setItem('${NBA_PROPS_TIMESTAMP_KEY}', String(now));
              }
            } catch (e) {}
          }());
        `);
      }
    }

    const aflCachePayload = buildAflCachePayload(aflData ?? {});
    if ((aflData?.success ?? false) && aflCachePayload) {
      const serialized = JSON.stringify({
        ...aflCachePayload,
        timestamp: Date.now(),
      });
      if (serialized.length <= AFL_INLINE_PAYLOAD_MAX_CHARS) {
        const escaped = escapeForInlineScript(serialized);
        inlineSeedScriptChunks.push(`
          (function(){
            try {
              var raw = sessionStorage.getItem('${AFL_PROPS_CACHE_KEY}');
              var parsed = raw ? JSON.parse(raw) : null;
              var ts = parsed && typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
              var isFresh = Number.isFinite(ts) && (Date.now() - ts) < ${CACHE_STALE_MS};
              if (!isFresh) {
                sessionStorage.setItem('${AFL_PROPS_CACHE_KEY}', '${escaped}');
              }
            } catch (e) {}
          }());
        `);
      }
    }
  }

  const inlineSeedScript = inlineSeedScriptChunks.join('\n');

  return (
    <>
      {inlineSeedScript ? (
        <script
          dangerouslySetInnerHTML={{
            __html: inlineSeedScript,
          }}
        />
      ) : null}
      {children}
    </>
  );
}
