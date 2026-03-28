import { NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { calculateUniversalBetResult } from '@/lib/betResultUtils';
import { footywireNicknameToOfficial, opponentToFootywireTeam } from '@/lib/aflTeamMapping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BALLDONTLIE_API_KEY) {
  throw new Error('BALLDONTLIE_API_KEY environment variable is required');
}

const GAME_TOTAL_STAT_TYPES = [
  'total_pts',
  'home_total',
  'away_total',
  'first_half_total',
  'second_half_total',
  'q1_total',
  'q2_total',
  'q3_total',
  'q4_total',
];
const AFL_STAT_TYPES = [
  'disposals',
  'kicks',
  'handballs',
  'marks',
  'goals',
  'behinds',
  'tackles',
  'clearances',
];

function isGameFinal(game: any): boolean {
  const rawStatus = String(game?.status || '');
  const status = rawStatus.toLowerCase();

  // SAFETY: Only trust explicit final/completed markers from BallDontLie.
  // We do NOT treat non-null scores as "final" because scores update during the game.
  return status.includes('final') || status.includes('completed') || rawStatus === 'Final';
}

function getTipoffMs(game: any): number | null {
  const raw = game?.date;
  if (!raw) return null;
  const ms = Date.parse(String(raw));
  return Number.isNaN(ms) ? null : ms;
}

function isGameLive(game: any): boolean {
  if (!game) return false;
  if (isGameFinal(game)) return false;
  const tipoff = getTipoffMs(game);
  if (!tipoff) return false;
  const now = Date.now();
  const elapsed = now - tipoff;
  // NBA games are usually < 3 hours; we use 4h to be safe.
  return elapsed >= 0 && elapsed < 4 * 60 * 60 * 1000;
}

function parseMinutesToNumber(min: any): number {
  if (min == null) return 0;
  const s = String(min).trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map((v) => Number(v));
    const mins = Number.isFinite(m) ? m : 0;
    const secs = Number.isFinite(sec) ? sec : 0;
    return mins + secs / 60;
  }
  const asNum = Number(s);
  return Number.isFinite(asNum) ? asNum : 0;
}

function parseAflResultScores(resultText: string): { team: number; opponent: number } | null {
  const m = String(resultText || '').match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  const team = Number(m[1]);
  const opponent = Number(m[2]);
  if (!Number.isFinite(team) || !Number.isFinite(opponent)) return null;
  return { team, opponent };
}

function isLikelyAflTeamName(teamName: string): boolean {
  if (!teamName) return false;
  return Boolean(opponentToFootywireTeam(teamName) || footywireNicknameToOfficial(teamName));
}

function getPlayerActualValue(stats: any, statType: string): number | null {
  const pts = Number(stats?.pts ?? 0);
  const reb = Number(stats?.reb ?? 0);
  const ast = Number(stats?.ast ?? 0);
  const stl = Number(stats?.stl ?? 0);
  const blk = Number(stats?.blk ?? 0);
  const fg3m = Number(stats?.fg3m ?? 0);

  switch (statType) {
    case 'pts':
      return pts;
    case 'reb':
      return reb;
    case 'ast':
      return ast;
    case 'stl':
      return stl;
    case 'blk':
      return blk;
    case 'fg3m':
      return fg3m;
    case 'pr':
      return pts + reb;
    case 'pa':
      return pts + ast;
    case 'ra':
      return reb + ast;
    case 'pra':
      return pts + reb + ast;
    default:
      return null;
  }
}

function findGameForBet(games: any[], bet: any) {
  const team = bet?.team;
  const opponent = bet?.opponent;
  if (!team || !opponent) return null;

  return (
    games.find((g: any) => {
      const homeFull = g?.home_team?.full_name;
      const homeAbbr = g?.home_team?.abbreviation;
      const awayFull = g?.visitor_team?.full_name;
      const awayAbbr = g?.visitor_team?.abbreviation;

      const homeMatch = homeFull === team || homeAbbr === team;
      const awayMatch = awayFull === team || awayAbbr === team;
      const homeOppMatch = homeFull === opponent || homeAbbr === opponent;
      const awayOppMatch = awayFull === opponent || awayAbbr === opponent;

      return (homeMatch && awayOppMatch) || (awayMatch && homeOppMatch);
    }) || null
  );
}

function getGameTotalValue(game: any, statType: string, betTeam?: string): number | null {
  const homeScore = Number(game?.home_team_score ?? 0);
  const awayScore = Number(game?.visitor_team_score ?? 0);

  switch (statType) {
    case 'total_pts':
      return homeScore + awayScore;
    case 'home_total':
      return homeScore;
    case 'away_total':
      return awayScore;
    // For half/quarter totals we rely on BallDontLie period fields if present.
    case 'first_half_total':
      return Number(game?.home_q1 ?? 0) +
        Number(game?.home_q2 ?? 0) +
        Number(game?.visitor_q1 ?? 0) +
        Number(game?.visitor_q2 ?? 0);
    case 'second_half_total':
      return Number(game?.home_q3 ?? 0) +
        Number(game?.home_q4 ?? 0) +
        Number(game?.visitor_q3 ?? 0) +
        Number(game?.visitor_q4 ?? 0);
    case 'q1_total':
      return Number(game?.home_q1 ?? 0) + Number(game?.visitor_q1 ?? 0);
    case 'q2_total':
      return Number(game?.home_q2 ?? 0) + Number(game?.visitor_q2 ?? 0);
    case 'q3_total':
      return Number(game?.home_q3 ?? 0) + Number(game?.visitor_q3 ?? 0);
    case 'q4_total':
      return Number(game?.home_q4 ?? 0) + Number(game?.visitor_q4 ?? 0);
    default:
      return null;
  }
}

function isParlayBet(bet: any): boolean {
  const market = String(bet?.market || '').toLowerCase();
  const selection = String(bet?.selection || '');
  const hasParlayText = market.includes('parlay') || selection.startsWith('Parlay:');
  const hasParlayLegs = Array.isArray(bet?.parlay_legs) && bet.parlay_legs.length > 0;
  return hasParlayText || hasParlayLegs;
}

function normalizeAflTeamToken(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^vs\.?\s*/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function buildAflTeamAliases(team: string): string[] {
  const raw = String(team || '').trim();
  if (!raw) return [];

  const aliases = new Set<string>();
  aliases.add(raw);

  const nickname = opponentToFootywireTeam(raw);
  if (nickname) aliases.add(nickname);

  const officialFromRaw = footywireNicknameToOfficial(raw);
  if (officialFromRaw) aliases.add(officialFromRaw);

  if (nickname) {
    const officialFromNickname = footywireNicknameToOfficial(nickname);
    if (officialFromNickname) aliases.add(officialFromNickname);
  }

  return Array.from(aliases);
}

function aflOpponentMatches(gameOpponent: string, betOpponent: string): boolean {
  const gameAliases = buildAflTeamAliases(gameOpponent).map(normalizeAflTeamToken).filter(Boolean);
  const betAliases = buildAflTeamAliases(betOpponent).map(normalizeAflTeamToken).filter(Boolean);

  if (gameAliases.length === 0 || betAliases.length === 0) return false;

  for (const g of gameAliases) {
    for (const b of betAliases) {
      if (!g || !b) continue;
      if (g === b || g.includes(b) || b.includes(g)) return true;
    }
  }
  return false;
}

function parseAflDateOnlyMs(value: string): number | null {
  const dateOnly = String(value || '').split('T')[0];
  if (!dateOnly) return null;
  const ms = Date.parse(`${dateOnly}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function findAflPlayerGame(games: any[], gameDate: string, opponent: string): any | null {
  if (!Array.isArray(games) || games.length === 0) return null;

  const targetDate = String(gameDate || '').split('T')[0];
  const targetOpponent = String(opponent || '').trim();

  const byDate = targetDate
    ? games.filter((g: any) => String(g?.date ?? g?.game_date ?? '').split('T')[0] === targetDate)
    : [];

  // Best case: exact date + opponent alias match.
  if (byDate.length > 0 && targetOpponent) {
    const dateAndOpponent = byDate.find((g: any) =>
      aflOpponentMatches(String(g?.opponent ?? '').trim(), targetOpponent)
    );
    if (dateAndOpponent) return dateAndOpponent;
  }

  // Timezone tolerance: allow +/- 1 day date drift from source parsing.
  const targetMs = parseAflDateOnlyMs(targetDate);
  if (targetMs != null) {
    const byNearbyDate = games.filter((g: any) => {
      const gameMs = parseAflDateOnlyMs(String(g?.date ?? g?.game_date ?? ''));
      return gameMs != null && Math.abs(gameMs - targetMs) <= 24 * 60 * 60 * 1000;
    });
    if (byNearbyDate.length > 0 && targetOpponent) {
      const nearbyAndOpponent = byNearbyDate.find((g: any) =>
        aflOpponentMatches(String(g?.opponent ?? '').trim(), targetOpponent)
      );
      if (nearbyAndOpponent) return nearbyAndOpponent;
    }
    if (byNearbyDate.length === 1) return byNearbyDate[0];
  }

  // If player has exactly one game on that date, trust date as authoritative.
  if (byDate.length === 1) {
    return byDate[0];
  }

  // Fallback: opponent-only alias match (used when source date is missing).
  if (targetOpponent) {
    const byOpponent = games.filter((g: any) =>
      aflOpponentMatches(String(g?.opponent ?? '').trim(), targetOpponent)
    );
    if (byOpponent.length === 1) return byOpponent[0];
    if (byOpponent.length > 1 && targetDate) {
      const exactDateWithinOpp = byOpponent.find(
        (g: any) => String(g?.date ?? g?.game_date ?? '').split('T')[0] === targetDate
      );
      if (exactDateWithinOpp) return exactDateWithinOpp;
      if (targetMs != null) {
        const nearestWithinOneDay = byOpponent.find((g: any) => {
          const gameMs = parseAflDateOnlyMs(String(g?.date ?? g?.game_date ?? ''));
          return gameMs != null && Math.abs(gameMs - targetMs) <= 24 * 60 * 60 * 1000;
        });
        if (nearestWithinOneDay) return nearestWithinOneDay;
      }
    }
  }

  return null;
}

export async function GET(request: Request) {
  // Allow bypass in development for local testing
  const isDevelopment = process.env.NODE_ENV === 'development';
  const bypassAuth = isDevelopment && request.headers.get('x-bypass-auth') === 'true';

  let userId: string | null = null;
  let isCron = false;

  if (!bypassAuth) {
    let isAuthorized = false;

    const url = new URL(request.url);
    const querySecret = url.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;

    // Query secret auth (manual)
    if (querySecret && cronSecret && querySecret === cronSecret) {
      isAuthorized = true;
      isCron = true;
    } else {
      // Header-based cron auth (Vercel cron / bearer)
      const authResult = authorizeCronRequest(request);
      if (authResult.authorized) {
        isAuthorized = true;
        isCron = true;
      }
    }

    // If not cron, fall back to user session auth
    if (!isAuthorized) {
      try {
        const supabase = await createClient();
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (session?.user && !error) {
          isAuthorized = true;
          userId = session.user.id;
        }
      } catch (e: any) {
        console.error('[check-journal-bets] Auth check failed:', e?.message);
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized - Must be a cron request or authenticated user' },
        { status: 401 }
      );
    }

    const rateResult = checkRateLimit(request, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }
  }

  try {
    const BATCH_SIZE = 200;
    let offset = 0;
    let hasMore = true;
    let updated = 0;
    let total = 0;
    const baseUrl =
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'http://localhost:3000';
    const cronSecret = process.env.CRON_SECRET || '';
    const aflRosterCache = new Map<string, string[]>();
    const aflPlayerLogsCache = new Map<string, any[]>();

    const cronHeaders: Record<string, string> = {};
    if (cronSecret) {
      cronHeaders.authorization = `Bearer ${cronSecret}`;
      cronHeaders['x-cron-secret'] = cronSecret;
    }

    const fetchAflPlayerLogs = async (
      season: number,
      playerName: string,
      teamName: string
    ): Promise<any[]> => {
      const cacheKey = `${season}|${playerName}|${teamName}`;
      const cached = aflPlayerLogsCache.get(cacheKey);
      if (cached) return cached;

      const params = new URLSearchParams({
        season: String(season),
        player_name: playerName,
        team: teamName,
        force_fetch: '1',
      });
      const res = await fetch(`${baseUrl}/api/afl/player-game-logs?${params}`, {
        cache: 'no-store',
        headers: cronHeaders,
      });
      if (!res.ok) return [];
      const data = await res.json();
      const games = Array.isArray(data?.games) ? data.games : [];
      aflPlayerLogsCache.set(cacheKey, games);
      return games;
    };

    const resolveAflMoneylineWin = async (
      season: number,
      gameDate: string,
      teamName: string,
      opponentName: string
    ): Promise<boolean | null> => {
      const teamKey = String(teamName || '').trim();
      if (!teamKey || !opponentName || !gameDate) return null;

      let playerNames = aflRosterCache.get(teamKey) ?? [];
      if (playerNames.length === 0) {
        const params = new URLSearchParams({ team: teamKey, limit: '12' });
        const rosterRes = await fetch(`${baseUrl}/api/afl/players?${params}`, {
          cache: 'no-store',
          headers: cronHeaders,
        });
        if (!rosterRes.ok) return null;
        const rosterJson = await rosterRes.json();
        playerNames = Array.isArray(rosterJson?.players)
          ? rosterJson.players
              .map((p: any) => String(p?.name || '').trim())
              .filter(Boolean)
          : [];
        aflRosterCache.set(teamKey, playerNames);
      }

      for (const candidate of playerNames.slice(0, 6)) {
        const games = await fetchAflPlayerLogs(season, candidate, teamKey);
        const game = findAflPlayerGame(games, gameDate, opponentName);
        if (!game) continue;
        const scores = parseAflResultScores(String(game?.result || ''));
        if (!scores) continue;
        if (scores.team === scores.opponent) return null;
        return scores.team > scores.opponent;
      }

      return null;
    };

    // Resolve NBA bets that are still pending/live.
    const allCandidates: any[] = [];

    while (hasMore) {
      let query = supabaseAdmin
        .from('bets')
        .select(
          'id, user_id, sport, market, selection, team, opponent, player_id, player_name, stat_type, over_under, line, game_date, date, status, result, parlay_legs'
        )
        .eq('sport', 'NBA')
        .in('status', ['pending', 'live'])
        .eq('result', 'pending')
        .order('game_date', { ascending: false })
        .range(offset, offset + BATCH_SIZE - 1);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data: batch, error } = await query;
      if (error) throw error;

      if (batch && batch.length > 0) {
        allCandidates.push(...batch);
        hasMore = batch.length === BATCH_SIZE;
        offset += BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }

    const singleBets = allCandidates.filter((b) => !isParlayBet(b));
    const parlayBets = allCandidates.filter((b) => isParlayBet(b));

    total = singleBets.length + parlayBets.length;

    // Group single bets by date to reduce games API calls
    const byDate = singleBets.reduce<Record<string, any[]>>((acc, bet) => {
      const d = String(bet.game_date || bet.date || '').split('T')[0];
      if (!d) return acc;
      if (!acc[d]) acc[d] = [];
      acc[d].push(bet);
      return acc;
    }, {});

    for (const [gameDate, bets] of Object.entries(byDate)) {
      const gamesRes = await fetch(`https://api.balldontlie.io/v1/games?dates[]=${gameDate}`, {
        headers: {
          Authorization: `Bearer ${BALLDONTLIE_API_KEY}`,
        },
        cache: 'no-store',
      });

      if (!gamesRes.ok) {
        console.error(`[check-journal-bets] Failed to fetch games for ${gameDate}: ${gamesRes.status}`);
        continue;
      }

      const gamesJson = await gamesRes.json();
      const games = Array.isArray(gamesJson?.data) ? gamesJson.data : [];
      if (games.length === 0) continue;

      for (const bet of bets) {
        // Sanity: must have core fields
        const statType = String(bet?.stat_type || '').trim();
        const overUnder = bet?.over_under;
        const line = typeof bet?.line === 'number' ? bet.line : Number(bet?.line);

        if (!statType) continue;

        const game = findGameForBet(games, bet);
        if (!game) continue;

        // Update live status if the game started but isn't final yet
        if (isGameLive(game)) {
          if (bet.status !== 'live') {
            const { error: liveErr } = await supabaseAdmin
              .from('bets')
              .update({ status: 'live' })
              .eq('id', bet.id)
              .in('status', ['pending', 'live'])
              .eq('result', 'pending');
            if (!liveErr) updated++;
          }
          continue;
        }

        if (!isGameFinal(game)) {
          continue;
        }

        // Player props
        if (
          ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'pr', 'pa', 'ra', 'pra'].includes(statType)
        ) {
          if (!bet.player_id) continue;
          if (overUnder !== 'over' && overUnder !== 'under') continue;
          if (!Number.isFinite(line)) continue;

          const statsRes = await fetch(
            `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${bet.player_id}`,
            {
              headers: {
                Authorization: `Bearer ${BALLDONTLIE_API_KEY}`,
              },
              cache: 'no-store',
            }
          );

          if (!statsRes.ok) continue;
          const statsJson = await statsRes.json();
          const rows = Array.isArray(statsJson?.data) ? statsJson.data : [];
          if (rows.length === 0) continue;
          const row = rows[0];

          const minutes = parseMinutesToNumber(row?.min);
          if (minutes <= 0) {
            const { error: voidErr } = await supabaseAdmin
              .from('bets')
              .update({
                status: 'completed',
                result: 'void',
                actual_value: 0,
              })
              .eq('id', bet.id)
              .in('status', ['pending', 'live'])
              .eq('result', 'pending');
            if (!voidErr) updated++;
            continue;
          }

          const actualValue = getPlayerActualValue(row, statType);
          if (actualValue == null) continue;

          const result = calculateUniversalBetResult(actualValue, line, overUnder, statType);

          const { error: updateErr } = await supabaseAdmin
            .from('bets')
            .update({
              status: 'completed',
              result,
              actual_value: actualValue,
            })
            .eq('id', bet.id)
            .in('status', ['pending', 'live'])
            .eq('result', 'pending');

          if (!updateErr) updated++;
          continue;
        }

        // Game props: moneyline, spread, and totals based on final score.
        if (statType === 'moneyline' || statType === 'spread' || GAME_TOTAL_STAT_TYPES.includes(statType)) {
          const homeScore = Number(game?.home_team_score ?? 0);
          const awayScore = Number(game?.visitor_team_score ?? 0);
          const homeTeamFull = game?.home_team?.full_name;
          const homeTeamAbbr = game?.home_team?.abbreviation;
          const awayTeamFull = game?.visitor_team?.full_name;
          const awayTeamAbbr = game?.visitor_team?.abbreviation;

          const betTeam = bet?.team;
          const isHome = betTeam === homeTeamFull || betTeam === homeTeamAbbr;
          const isAway = betTeam === awayTeamFull || betTeam === awayTeamAbbr;

          // For pure totals (not team-specific), we don't need to know which side was bet on.
          if (!GAME_TOTAL_STAT_TYPES.includes(statType) && !isHome && !isAway) continue;

          let actualValue: number | null = null;

          if (statType === 'moneyline') {
            actualValue = isHome ? (homeScore > awayScore ? 1 : 0) : awayScore > homeScore ? 1 : 0;
          } else if (statType === 'spread') {
            // spread: positive margin if bet team wins, negative if loses
            actualValue = isHome ? homeScore - awayScore : awayScore - homeScore;
          } else {
            // Totals: use combined score / partial totals
            actualValue = getGameTotalValue(game, statType, betTeam);
          }

          if (actualValue == null) continue;

          const ou: 'over' | 'under' =
            overUnder === 'over' || overUnder === 'under' ? overUnder : 'over';
          const ln = Number.isFinite(line) ? line : 0;
          const result = calculateUniversalBetResult(actualValue, ln, ou, statType);

          const { error: updateErr } = await supabaseAdmin
            .from('bets')
            .update({
              status: 'completed',
              result,
              actual_value: actualValue,
            })
            .eq('id', bet.id)
            .in('status', ['pending', 'live'])
            .eq('result', 'pending');

          if (!updateErr) updated++;
          continue;
        }
      }
    }

    // --- Parlay resolution (simple, leg-by-leg using same rules as singles) ---
    if (parlayBets.length > 0) {
      // Index parlays by id so we can mutate parlay_legs in-place
      const parlayById = new Map<string, any>();
      for (const bet of parlayBets) {
        parlayById.set(bet.id, bet);
      }

      // Collect all legs by game date
      const legsByDate: Record<
        string,
        { betId: string; legIndex: number; leg: any }
      >[] | any = {};
      const legsByDateMap: Record<
        string,
        { betId: string; legIndex: number; leg: any }[]
      > = {};

      for (const bet of parlayBets) {
        const legs: any[] = Array.isArray(bet.parlay_legs) ? bet.parlay_legs : [];
        legs.forEach((leg, index) => {
          const dateStr = String(
            leg?.gameDate || bet.game_date || bet.date || ''
          ).split('T')[0];
          if (!dateStr) return;
          if (!legsByDateMap[dateStr]) {
            legsByDateMap[dateStr] = [];
          }
          legsByDateMap[dateStr].push({ betId: bet.id, legIndex: index, leg });
        });
      }

      // Simple cache for player stats per game+player
      const statsCache = new Map<string, any>();

      for (const [gameDate, legEntries] of Object.entries(legsByDateMap)) {
        const gamesRes = await fetch(`https://api.balldontlie.io/v1/games?dates[]=${gameDate}`, {
          headers: {
            Authorization: `Bearer ${BALLDONTLIE_API_KEY}`,
          },
          cache: 'no-store',
        });

        if (!gamesRes.ok) {
          console.error(
            `[check-journal-bets] Failed to fetch games for ${gameDate} (parlays): ${gamesRes.status}`
          );
          continue;
        }

        const gamesJson = await gamesRes.json();
        const games = Array.isArray(gamesJson?.data) ? gamesJson.data : [];
        if (games.length === 0) continue;

        for (const entry of legEntries) {
          const bet = parlayById.get(entry.betId);
          if (!bet) continue;
          const legs: any[] = Array.isArray(bet.parlay_legs) ? bet.parlay_legs : [];
          const leg = legs[entry.legIndex];
          if (!leg) continue;

          const statType = String(leg?.statType || '').trim();
          const overUnder = leg?.overUnder;
          const line =
            typeof leg?.line === 'number' ? leg.line : Number(leg?.line);

          if (!statType) continue;

          const legGameDate = String(leg?.gameDate || bet.game_date || bet.date || '').split('T')[0];
          const legSeason = Number.parseInt(legGameDate.slice(0, 4), 10);
          const likelyAflLeg =
            AFL_STAT_TYPES.includes(statType) ||
            (statType === 'moneyline' &&
              isLikelyAflTeamName(String(leg?.team || '')) &&
              isLikelyAflTeamName(String(leg?.opponent || '')));

          if (likelyAflLeg && Number.isFinite(legSeason)) {
            if (AFL_STAT_TYPES.includes(statType)) {
              const playerName = String(leg?.playerName || '').trim();
              const teamName = String(leg?.team || '').trim();
              const oppName = String(leg?.opponent || '').trim();
              if (!playerName || !teamName || !oppName) continue;
              if (overUnder !== 'over' && overUnder !== 'under') continue;
              if (!Number.isFinite(line)) continue;

              const aflGames = await fetchAflPlayerLogs(legSeason, playerName, teamName);
              const aflGame = findAflPlayerGame(aflGames, legGameDate, oppName);
              if (!aflGame) continue;

              const raw = (aflGame as any)[statType];
              const actualValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
              if (!Number.isFinite(actualValue)) continue;

              const legResult = calculateUniversalBetResult(actualValue, line, overUnder, statType);
              leg.void = false;
              leg.won = legResult === 'win';
              leg.actualValue = actualValue;
              continue;
            }

            if (statType === 'moneyline') {
              const teamName = String(leg?.team || '').trim();
              const oppName = String(leg?.opponent || '').trim();
              if (!teamName || !oppName || !legGameDate) continue;

              const teamWon = await resolveAflMoneylineWin(legSeason, legGameDate, teamName, oppName);
              if (teamWon == null) continue;
              leg.void = false;
              leg.won = teamWon;
              leg.actualValue = teamWon ? 1 : 0;
              continue;
            }
          }

          const game = findGameForBet(games, {
            team: leg.team,
            opponent: leg.opponent,
          });
          if (!game) continue;

          // Do not resolve legs until game is final. We don't need explicit "live"
          // at leg level for parlays; the parent bet's status can remain pending/live.
          if (!isGameFinal(game)) {
            continue;
          }

          // Player prop legs
          if (
            !leg?.isGameProp &&
            ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'pr', 'pa', 'ra', 'pra'].includes(
              statType
            )
          ) {
            const playerId = leg?.playerId;
            if (!playerId) continue;
            if (overUnder !== 'over' && overUnder !== 'under') continue;
            if (!Number.isFinite(line)) continue;

            const cacheKey = `${game.id}-${playerId}`;
            let row = statsCache.get(cacheKey);

            if (!row) {
              const statsRes = await fetch(
                `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${playerId}`,
                {
                  headers: {
                    Authorization: `Bearer ${BALLDONTLIE_API_KEY}`,
                  },
                  cache: 'no-store',
                }
              );

              if (!statsRes.ok) continue;
              const statsJson = await statsRes.json();
              const rows = Array.isArray(statsJson?.data) ? statsJson.data : [];
              if (rows.length === 0) continue;
              row = rows[0];
              statsCache.set(cacheKey, row);
            }

            const minutes = parseMinutesToNumber(row?.min);
            if (minutes <= 0) {
              leg.void = true;
              leg.won = null;
              leg.actualValue = 0;
              continue;
            }

            const actualValue = getPlayerActualValue(row, statType);
            if (actualValue == null) continue;

            const result = calculateUniversalBetResult(
              actualValue,
              line,
              overUnder,
              statType
            );

            leg.void = false;
            leg.won = result === 'win';
            leg.actualValue = actualValue;
            continue;
          }

          // Simple game prop legs: moneyline, spread, and totals based on team + score
          if (statType === 'moneyline' || statType === 'spread' || GAME_TOTAL_STAT_TYPES.includes(statType)) {
            const homeScore = Number(game?.home_team_score ?? 0);
            const awayScore = Number(game?.visitor_team_score ?? 0);
            const homeTeamFull = game?.home_team?.full_name;
            const homeTeamAbbr = game?.home_team?.abbreviation;
            const awayTeamFull = game?.visitor_team?.full_name;
            const awayTeamAbbr = game?.visitor_team?.abbreviation;

            const legTeam = leg?.team;
            const isHome =
              legTeam === homeTeamFull || legTeam === homeTeamAbbr;
            const isAway =
              legTeam === awayTeamFull || legTeam === awayTeamAbbr;

            // Totals do not require a specific team; other game props do.
            if (!GAME_TOTAL_STAT_TYPES.includes(statType) && !isHome && !isAway) continue;

            let actualValue: number | null = null;

            if (statType === 'moneyline') {
              actualValue = isHome
                ? homeScore > awayScore
                  ? 1
                  : 0
                : awayScore > homeScore
                ? 1
                : 0;
            } else if (statType === 'spread') {
              actualValue = isHome
                ? homeScore - awayScore
                : awayScore - homeScore;
            } else {
              actualValue = getGameTotalValue(game, statType, legTeam);
            }

            if (actualValue == null) continue;

            const ou: 'over' | 'under' =
              overUnder === 'over' || overUnder === 'under' ? overUnder : 'over';
            const ln = Number.isFinite(line) ? line : 0;
            const result = calculateUniversalBetResult(
              actualValue,
              ln,
              ou,
              statType
            );

            leg.void = false;
            leg.won = result === 'win';
            leg.actualValue = actualValue;
            continue;
          }
        }
      }

      // Now decide each parlay's overall result based on leg outcomes
      for (const bet of parlayBets) {
        const legs: any[] = Array.isArray(bet.parlay_legs) ? bet.parlay_legs : [];
        if (legs.length === 0) continue;

        let nonVoidTotal = 0;
        let nonVoidWins = 0;
        let voidCount = 0;
        let hasPending = false;

        for (const leg of legs) {
          if (leg?.void) {
            voidCount++;
            continue;
          }

          if (typeof leg?.won === 'boolean') {
            nonVoidTotal++;
            if (leg.won) {
              nonVoidWins++;
            }
          } else {
            // Leg not resolved yet (game not final or unsupported stat type)
            hasPending = true;
          }
        }

        if (hasPending) {
          // At least one leg is not settled yet – keep parlay pending for now.
          continue;
        }

        let parlayResult: 'win' | 'loss' | 'void' | null = null;
        if (nonVoidTotal === 0 && voidCount > 0) {
          parlayResult = 'void';
        } else if (nonVoidTotal > 0 && nonVoidWins === nonVoidTotal) {
          parlayResult = 'win';
        } else if (nonVoidTotal > 0 && nonVoidWins < nonVoidTotal) {
          parlayResult = 'loss';
        }

        if (!parlayResult) continue;

        const { error: parlayErr } = await supabaseAdmin
          .from('bets')
          .update({
            status: 'completed',
            result: parlayResult,
            parlay_legs: legs,
          })
          .eq('id', bet.id)
          .in('status', ['pending', 'live'])
          .eq('result', 'pending');

        if (!parlayErr) {
          updated++;
        }
      }
    }

    // --- AFL single-bet resolution ---
    let aflOffset = 0;
    let aflHasMore = true;
    const aflCandidates: any[] = [];

    while (aflHasMore) {
      let aflQuery = supabaseAdmin
        .from('bets')
        .select('id, user_id, sport, team, opponent, player_name, stat_type, over_under, line, game_date, status, result')
        .eq('sport', 'AFL')
        .in('status', ['pending', 'live'])
        .eq('result', 'pending')
        .order('game_date', { ascending: false })
        .range(aflOffset, aflOffset + BATCH_SIZE - 1);

      if (userId) aflQuery = aflQuery.eq('user_id', userId);

      const { data: aflBatch, error: aflErr } = await aflQuery;
      if (aflErr) break;
      if (aflBatch && aflBatch.length > 0) {
        aflCandidates.push(...aflBatch);
        aflHasMore = aflBatch.length === BATCH_SIZE;
        aflOffset += BATCH_SIZE;
      } else {
        aflHasMore = false;
      }
    }

    const aflSingleBets = aflCandidates.filter((b) => !isParlayBet(b));
    const grandTotal = total + aflSingleBets.length;

    if (grandTotal === 0) {
      return NextResponse.json({
        message: 'No pending journal bets to check',
        updated: 0,
        total: 0,
        scope: userId ? 'user' : isCron ? 'cron' : 'unknown',
      });
    }
    for (const bet of aflSingleBets) {
      const gameDate = String(bet?.game_date ?? '').split('T')[0];
      const playerName = String(bet?.player_name ?? '').trim();
      const team = String(bet?.team ?? '').trim();
      const opponent = String(bet?.opponent ?? '').trim();
      const statType = String(bet?.stat_type ?? '').trim();
      const overUnder = bet?.over_under === 'under' ? 'under' : 'over';
      const line = typeof bet?.line === 'number' ? bet.line : Number(bet?.line);

      if (!gameDate || !team) continue;

      const season = parseInt(gameDate.slice(0, 4), 10);
      if (!Number.isFinite(season)) continue;

      try {
        let actualValue: number | null = null;
        let result: 'win' | 'loss' | 'void' | null = null;

        if (AFL_STAT_TYPES.includes(statType)) {
          if (!playerName || !Number.isFinite(line)) continue;
          const games = await fetchAflPlayerLogs(season, playerName, team);
          const game = findAflPlayerGame(games, gameDate, opponent);
          if (!game) continue;
          const raw = (game as any)[statType];
          const val = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
          if (!Number.isFinite(val)) continue;
          actualValue = val;
          result = calculateUniversalBetResult(actualValue, line, overUnder, statType);
        } else if (statType === 'moneyline') {
          const teamWon = await resolveAflMoneylineWin(season, gameDate, team, opponent);
          if (teamWon == null) continue;
          actualValue = teamWon ? 1 : 0;
          result = teamWon ? 'win' : 'loss';
        } else {
          continue;
        }

        const { error: updateErr } = await supabaseAdmin
          .from('bets')
          .update({
            status: 'completed',
            result,
            actual_value: actualValue,
          })
          .eq('id', bet.id)
          .in('status', ['pending', 'live'])
          .eq('result', 'pending');

        if (!updateErr) updated++;
      } catch {
        // Skip this bet on error (e.g. API not reachable)
      }
    }

    return NextResponse.json({
      message: 'Journal bet check completed',
      updated,
      total: grandTotal,
      scope: userId ? 'user' : isCron ? 'cron' : 'unknown',
    });
  } catch (error: any) {
    console.error('[check-journal-bets] Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to check journal bets' }, { status: 500 });
  }
}

