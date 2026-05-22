'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { fetchProfileProStatusWithRetries, isProFromUserMetadata } from '@/lib/profileSubscriptionGate';
import { useTheme } from '@/contexts/ThemeContext';
import { DashboardStyles } from '@/app/nba/research/dashboard/components/DashboardStyles';
import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { useDashboardStyles } from '@/app/nba/research/dashboard/hooks/useDashboardStyles';
import { useCountdownTimer } from '@/app/nba/research/dashboard/hooks/useCountdownTimer';
import { Search } from 'lucide-react';
import {
  hasDisplayableSoccerLineup,
  type SoccerwayLineupBundle,
  type SoccerwayLineupPlayer,
  type SoccerwayRecentMatch,
} from '@/lib/soccerwayTeamResults';
import { SoccerStatsChart, type SoccerStatTeamScope, type SoccerTimeframe } from '@/app/soccer/components/SoccerStatsChart';
import { SoccerSupportingStats } from '@/app/soccer/components/SoccerSupportingStats';
import { SoccerPredictedLineup } from '@/app/soccer/components/SoccerPredictedLineup';
import { SoccerOpponentBreakdownMatchupPanel } from '@/app/soccer/components/SoccerOpponentBreakdownMatchupPanel';
import { SoccerTeamFormHomeAwayPanel } from '@/app/soccer/components/SoccerTeamFormHomeAwayPanel';
import { SoccerInjuriesCard } from '@/app/soccer/components/SoccerInjuriesCard';
import { SoccerPlayerPropsTestCard } from '@/app/soccer/components/SoccerPlayerPropsTestCard';
import { SoccerPlayerSupportingStats } from '@/app/soccer/components/SoccerPlayerSupportingStats';
import type { SoccerPlayerPropsChartSnapshot } from '@/app/soccer/components/soccerPlayerPropsTypes';

/** Same card chrome as `app/afl/page.tsx` (AFL dashboard). */
const AFL_DASH_CARD_GLOW =
  'border border-gray-200 dark:border-[#463e6b] bg-white dark:bg-[#0a1929] shadow-[0_8px_24px_rgba(0,0,0,0.08),0_0_20px_rgba(124,58,237,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22),0_0_36px_rgba(124,58,237,0.22)]';

type SoccerDashboardPayload = {
  matchSample?: Record<string, unknown> | null;
  teamSample?: Record<string, unknown> | null;
};

type SoccerNextFixture = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  opponentName: string;
  isHome: boolean | null;
  teamLogoUrl: string | null;
  opponentLogoUrl: string | null;
  kickoffUnix: number | null;
  summaryPath: string;
  competitionName: string | null;
  competitionCountry: string | null;
  competitionStage: string | null;
};

type SoccerPredictedLineupResponse = {
  summaryPath: string | null;
  lineupsPath: string | null;
  eventId: string | null;
  lineup: SoccerwayLineupBundle | null;
  lineupFrom?: 'upcoming' | 'previous';
};

type SoccerOddsOutcome = {
  participant: string | null;
  side: 'home' | 'away' | null;
  selection: string | null;
  value: string | null;
  active: boolean;
};

type SoccerOddsOffer = {
  odds: SoccerOddsOutcome[];
};

type SoccerOddsMarket = {
  key: string;
  bettingType: string | null;
  bettingScope: string | null;
  offers: SoccerOddsOffer[];
};

type SoccerTeamRow = {
  name: string;
  href: string;
  competitions: Array<{ country: string; competition: string }>;
};

type SoccerPlayerOption = {
  id: string;
  name: string;
  shortName: string;
  teamName: string;
  teamHref: string | null;
  number: string | null;
  imageUrl: string | null;
  role: string | null;
  status: 'starter' | 'substitute' | 'test' | 'cached';
  /** From player-stats-roster-report when status is cached */
  cachedMatchCount?: number;
};

type CachedSoccerRosterRow = {
  playerKey: string;
  displayName: string;
  matchCount: number;
  teamHref?: string;
  position?: string | null;
};

function extractSoccerwayPlayerSlugFromParticipantUrl(url: string | null | undefined): string | null {
  const m = String(url || '').trim().match(/\/player\/([^/]+)\//i);
  return m?.[1] ? m[1].trim().toLowerCase() : null;
}

function findCachedRosterRowFromLineupPick(
  roster: CachedSoccerRosterRow[],
  pending: { playerKey: string; displayName: string }
): CachedSoccerRosterRow | undefined {
  if (pending.playerKey) {
    const byKey = roster.find((r) => r.playerKey === pending.playerKey);
    if (byKey) return byKey;
  }
  const label = foldSoccerPlayerSearchText(pending.displayName);
  if (!label) return undefined;
  return (
    roster.find((r) => foldSoccerPlayerSearchText(r.displayName) === label) ??
    roster.find((r) => {
      const h = foldSoccerPlayerSearchText(r.displayName);
      return h.length >= 3 && label.length >= 3 && (h.includes(label) || label.includes(h));
    })
  );
}

function findCachedRosterRowForLineupPlayer(
  roster: CachedSoccerRosterRow[],
  player: SoccerwayLineupPlayer,
  teamHref?: string | null
): CachedSoccerRosterRow | undefined {
  const normalizedHref = normalizeTeamHref(teamHref ?? '');
  const scoped = normalizedHref
    ? roster.filter((r) => !r.teamHref || normalizeTeamHref(r.teamHref) === normalizedHref)
    : roster;
  const slug = extractSoccerwayPlayerSlugFromParticipantUrl(player.participantUrl);
  if (slug) {
    const bySlug = scoped.find((r) => r.playerKey === slug);
    if (bySlug) return bySlug;
  }
  return findCachedRosterRowFromLineupPick(scoped, {
    playerKey: '',
    displayName: player.listName || player.fieldName,
  });
}

type SoccerLineupPlayerInfo = { number: string | null; position: string | null };
type SoccerLineupInfoLookup = {
  bySlug: Map<string, SoccerLineupPlayerInfo>;
  byName: Map<string, SoccerLineupPlayerInfo>;
};

const EMPTY_LINEUP_INFO_LOOKUP: SoccerLineupInfoLookup = {
  bySlug: new Map(),
  byName: new Map(),
};

/**
 * Map Soccerway formation-line names (e.g. "Goalkeeper", "Defenders", "Midfielders", "Forwards") to short tags.
 * Returns null when the name is generic ("Line") or unrecognised — caller should fall back to index-based derivation.
 */
function abbreviateFormationLineName(name: string | null | undefined): string | null {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  if (n.startsWith('goal') || n === 'gk' || n.startsWith('keeper')) return 'GK';
  if (n.startsWith('def') || n.startsWith('back') || n === 'd') return 'DEF';
  if (n.startsWith('mid') || n === 'm') return 'MID';
  if (n.startsWith('forw') || n.startsWith('att') || n.startsWith('str') || n.startsWith('fw') || n === 'f') return 'FWD';
  return null;
}

/**
 * Derive a position abbreviation from a player's formation-row index.
 * Used when Soccerway only returns generic "Line" names. `gkAtStart` flips the mapping
 * because some Soccerway payloads list formation lines from FWD→GK rather than GK→FWD.
 */
function derivePositionFromFormationIndex(idx: number, total: number, gkAtStart: boolean): string | null {
  if (total <= 0 || idx < 0) return null;
  if (total === 1) return null;
  const gkIdx = gkAtStart ? 0 : total - 1;
  const fwdIdx = gkAtStart ? total - 1 : 0;
  const defIdx = gkAtStart ? 1 : total - 2;
  if (idx === gkIdx) return 'GK';
  if (idx === fwdIdx) return 'FWD';
  if (idx === defIdx) return 'DEF';
  return 'MID';
}

function lookupSoccerLineupPlayerInfo(
  lookup: SoccerLineupInfoLookup,
  playerKey: string,
  displayName: string
): SoccerLineupPlayerInfo | null {
  const bySlug = lookup.bySlug.get(playerKey.toLowerCase());
  if (bySlug) return bySlug;
  const norm = normalizeSoccerName(displayName);
  return (norm && lookup.byName.get(norm)) || null;
}

function buildSoccerPlayerOptionFromRosterRow(
  row: CachedSoccerRosterRow,
  team: SoccerTeamRow,
  lineupImageByNormalizedName: Map<string, string>,
  lineupInfoLookup: SoccerLineupInfoLookup = EMPTY_LINEUP_INFO_LOOKUP
): SoccerPlayerOption {
  const href = normalizeTeamHref(team.href);
  const parts = row.displayName.trim().split(/\s+/).filter(Boolean);
  const shortName =
    parts.length >= 2
      ? `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase() || row.displayName.slice(0, 3)
      : row.displayName.slice(0, 3);
  const norm = normalizeSoccerName(row.displayName);
  const info = lookupSoccerLineupPlayerInfo(lineupInfoLookup, row.playerKey, row.displayName);
  return {
    id: row.playerKey,
    name: row.displayName,
    shortName,
    teamName: team.name,
    teamHref: href || null,
    number: info?.number ?? null,
    imageUrl: lineupImageByNormalizedName.get(norm) ?? null,
    role: row.position ?? info?.position ?? null,
    status: row.matchCount > 0 ? ('cached' as const) : ('test' as const),
    cachedMatchCount: row.matchCount > 0 ? row.matchCount : undefined,
  };
}

type SoccerDashboardSessionState = {
  team: Pick<SoccerTeamRow, 'name' | 'href'>;
  recentMatches: SoccerwayRecentMatch[];
  nextFixture?: SoccerNextFixture | null;
  cachedAt: number;
  /** When set, restore Player props + this roster row after refresh (same keys as cache playerKey). */
  playerProps?: { playerKey: string; displayName: string } | null;
};

// Bump the restore cache version when the stored match payload shape/coverage changes.
const SOCCER_DASHBOARD_SESSION_PREFIX = 'soccer-dashboard:v8:';
const SOCCER_LINEUP_UI_SNAP_PREFIX = 'soccer-lineup-ui:v1:';

function readLineupUiSnap(teamHref: string): { lineup: SoccerwayLineupBundle; lineupFrom: 'upcoming' | 'previous' } | null {
  if (typeof window === 'undefined') return null;
  const key = normalizeTeamHref(teamHref);
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(`${SOCCER_LINEUP_UI_SNAP_PREFIX}${key}`);
    if (!raw) return null;
    const o = JSON.parse(raw) as { lineup?: SoccerwayLineupBundle; lineupFrom?: string } | null;
    if (!o?.lineup || typeof o.lineup !== 'object') return null;
    if (!hasDisplayableSoccerLineup(o.lineup)) return null;
    return {
      lineup: o.lineup,
      lineupFrom: o.lineupFrom === 'previous' ? 'previous' : 'upcoming',
    };
  } catch {
    return null;
  }
}

function writeLineupUiSnap(
  teamHref: string,
  payload: { lineup: SoccerwayLineupBundle | null; lineupFrom: 'upcoming' | 'previous' }
): void {
  if (typeof window === 'undefined') return;
  const key = normalizeTeamHref(teamHref);
  if (!key) return;
  try {
    if (!payload.lineup || !hasDisplayableSoccerLineup(payload.lineup)) {
      window.sessionStorage.removeItem(`${SOCCER_LINEUP_UI_SNAP_PREFIX}${key}`);
      return;
    }
    const str = JSON.stringify({ lineup: payload.lineup, lineupFrom: payload.lineupFrom });
    if (str.length > 4_500_000) return;
    window.sessionStorage.setItem(`${SOCCER_LINEUP_UI_SNAP_PREFIX}${key}`, str);
  } catch {
    /* ignore quota */
  }
}
const EMPTY_STATS_SKELETON_MS = 5000;
const EMPTY_STATS_CACHE_RETRY_DELAY_MS = 750;
const INITIAL_RECENT_MATCHES_LIMIT = 20;

function getSoccerDashboardSessionKey(teamHref: string): string {
  return `${SOCCER_DASHBOARD_SESSION_PREFIX}${normalizeTeamHref(teamHref)}`;
}

function parseSessionPlayerPropsField(raw: unknown): { playerKey: string; displayName: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const pk = String(o.playerKey || '').trim().toLowerCase();
  const dn = String(o.displayName || '').trim();
  if (!/^[a-z0-9-]{2,80}$/.test(pk) || !dn) return null;
  return { playerKey: pk, displayName: dn };
}

function readSoccerDashboardSessionState(teamHref: string): SoccerDashboardSessionState | null {
  if (typeof window === 'undefined') return null;
  const normalizedHref = normalizeTeamHref(teamHref);
  if (!normalizedHref) return null;
  try {
    const raw = window.sessionStorage.getItem(getSoccerDashboardSessionKey(normalizedHref));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SoccerDashboardSessionState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const teamName = typeof parsed.team?.name === 'string' ? parsed.team.name.trim() : '';
    const teamStoredHref = typeof parsed.team?.href === 'string' ? normalizeTeamHref(parsed.team.href) : '';
    const recentMatches = Array.isArray(parsed.recentMatches) ? (parsed.recentMatches as SoccerwayRecentMatch[]) : [];
    const nextFixture =
      parsed.nextFixture && typeof parsed.nextFixture === 'object'
        ? (parsed.nextFixture as SoccerNextFixture)
        : null;
    const playerProps = parseSessionPlayerPropsField((parsed as { playerProps?: unknown }).playerProps);
    const hasRecent = recentMatches.length > 0;
    const hasNextFixture =
      nextFixture != null &&
      (String(nextFixture.matchId || '').trim() !== '' || String(nextFixture.summaryPath || '').trim() !== '');
    if (!teamName || !teamStoredHref || teamStoredHref !== normalizedHref) return null;
    // Do not require recentMatches: session can still carry playerProps / next fixture after partial writes or TTL.
    if (!hasRecent && !hasNextFixture && !playerProps) return null;
    return {
      team: { name: teamName, href: teamStoredHref },
      recentMatches,
      nextFixture,
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : Date.now(),
      ...(playerProps ? { playerProps } : {}),
    };
  } catch {
    return null;
  }
}

function writeSoccerDashboardSessionState(
  team: Pick<SoccerTeamRow, 'name' | 'href'>,
  data: {
    recentMatches?: SoccerwayRecentMatch[];
    nextFixture?: SoccerNextFixture | null;
    /** Pass null to clear saved Player props selection. Omit to leave previous value. */
    playerProps?: SoccerDashboardSessionState['playerProps'] | null;
  }
): void {
  if (typeof window === 'undefined') return;
  const normalizedHref = normalizeTeamHref(team.href);
  if (!normalizedHref || !team.name.trim()) return;
  try {
    const existingRaw = window.sessionStorage.getItem(getSoccerDashboardSessionKey(normalizedHref));
    const existingParsed = existingRaw ? (JSON.parse(existingRaw) as Partial<SoccerDashboardSessionState> | null) : null;
    const existingRecentMatches = Array.isArray(existingParsed?.recentMatches)
      ? (existingParsed.recentMatches as SoccerwayRecentMatch[])
      : [];
    const existingNextFixture =
      existingParsed?.nextFixture && typeof existingParsed.nextFixture === 'object'
        ? (existingParsed.nextFixture as SoccerNextFixture)
        : null;
    const recentMatches = data.recentMatches ?? existingRecentMatches;
    const nextFixture = data.nextFixture !== undefined ? data.nextFixture : existingNextFixture;
    if (recentMatches.length === 0 && !nextFixture) return;
    const mergedPlayerProps =
      data.playerProps !== undefined
        ? data.playerProps
        : parseSessionPlayerPropsField((existingParsed as { playerProps?: unknown })?.playerProps);
    const payload: SoccerDashboardSessionState = {
      team: { name: team.name.trim(), href: normalizedHref },
      recentMatches,
      nextFixture,
      cachedAt: Date.now(),
      ...(mergedPlayerProps ? { playerProps: mergedPlayerProps } : {}),
    };
    window.sessionStorage.setItem(getSoccerDashboardSessionKey(normalizedHref), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function parseUniqueTeamsFromSample(teamSample: Record<string, unknown> | null | undefined): SoccerTeamRow[] {
  const raw = teamSample?.uniqueTeams;
  if (!Array.isArray(raw)) return [];
  const rows: SoccerTeamRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const href = typeof o.href === 'string' ? o.href.trim() : '';
    if (!name || !href) continue;
    const compsRaw = Array.isArray(o.competitions) ? o.competitions : [];
    const competitions = compsRaw
      .map((c) => {
        if (!c || typeof c !== 'object') return null;
        const x = c as Record<string, unknown>;
        return {
          country: typeof x.country === 'string' ? x.country : '',
          competition: typeof x.competition === 'string' ? x.competition : '',
        };
      })
      .filter((c): c is { country: string; competition: string } => c != null);
    rows.push({ name, href, competitions });
  }
  return rows;
}

function teamMatchesQuery(team: SoccerTeamRow, q: string): boolean {
  const n = team.name.toLowerCase();
  if (n.includes(q)) return true;
  for (const c of team.competitions) {
    if (c.country.toLowerCase().includes(q)) return true;
    if (c.competition.toLowerCase().includes(q)) return true;
  }
  return false;
}

function normalizeTeamHref(value: string | null | undefined): string {
  const href = String(value || '').trim();
  if (!href) return '';
  return (href.startsWith('/') ? href : `/${href}`).replace(/\/+$/, '');
}

function normalizeSoccerName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
}

/** Lowercase + strip accents + hyphens→spaces for player search (ASCII queries vs Soccerway diacritics). */
function foldSoccerPlayerSearchText(value: string | null | undefined): string {
  const base = String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return base
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSoccerMarketText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSoccerDecimalOdds(value: string | null | undefined): number | null {
  const n = Number.parseFloat(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 1 ? n : null;
}

function medianNumber(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function getSelectedSoccerSide(teamName: string | null | undefined, fixture: SoccerNextFixture | null): 'home' | 'away' | null {
  if (!teamName || !fixture) return null;
  if (fixture.isHome === true) return 'home';
  if (fixture.isHome === false) return 'away';
  const selected = normalizeSoccerName(teamName);
  if (normalizeSoccerName(fixture.homeTeam) === selected) return 'home';
  if (normalizeSoccerName(fixture.awayTeam) === selected) return 'away';
  return null;
}

function calculateSoccerWinPercentageFromOdds(
  markets: SoccerOddsMarket[] | null | undefined,
  selectedSide: 'home' | 'away' | null
): number | null {
  if (!selectedSide) return null;

  const bookPercentages: number[] = [];

  for (const market of markets ?? []) {
    const bettingType = String(market.bettingType || '').trim().toUpperCase();
    const bettingScope = String(market.bettingScope || '').trim().toUpperCase();
    const marketKey = String(market.key || '').trim().toUpperCase();
    const isMoneylineMarket =
      marketKey === 'HOME_DRAW_AWAY__FULL_TIME' ||
      (bettingType === 'HOME_DRAW_AWAY' && (!bettingScope || bettingScope === 'FULL_TIME'));
    if (!isMoneylineMarket) continue;

    for (const offer of market.offers ?? []) {
      let homeDecimal: number | null = null;
      let drawDecimal: number | null = null;
      let awayDecimal: number | null = null;

      for (const outcome of offer.odds ?? []) {
        if (!outcome.active || !outcome.value) continue;
        const selection = normalizeSoccerMarketText(`${outcome.selection || ''} ${outcome.participant || ''}`);
        const decimal = parseSoccerDecimalOdds(outcome.value);
        if (decimal == null) continue;

        if (outcome.side === 'home' || selection === '1' || selection.includes('home')) homeDecimal = decimal;
        else if (outcome.side === 'away' || selection === '2' || selection.includes('away')) awayDecimal = decimal;
        else if (selection === 'x' || selection.includes('draw')) drawDecimal = decimal;
      }

      const selectedDecimal = selectedSide === 'home' ? homeDecimal : awayDecimal;
      if (selectedDecimal == null) continue;

      const selectedImplied = 1 / selectedDecimal;
      const marketImpliedTotal =
        (homeDecimal != null ? 1 / homeDecimal : 0) +
        (drawDecimal != null ? 1 / drawDecimal : 0) +
        (awayDecimal != null ? 1 / awayDecimal : 0);
      const normalized = marketImpliedTotal > 0 ? (selectedImplied / marketImpliedTotal) * 100 : selectedImplied * 100;
      if (Number.isFinite(normalized)) bookPercentages.push(normalized);
    }
  }

  return medianNumber(bookPercentages);
}

function splitFixtureNameLines(value: string | null | undefined): [string, string?] {
  const name = String(value || '').trim();
  if (!name) return ['-'];
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [name];
  return [parts[0], parts.slice(1).join(' ')];
}

function sortSoccerMatchesByRecency(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return [...matches].sort((a, b) => {
    const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    if (aKickoff !== bKickoff) return bKickoff - aKickoff;
    return String(b.matchId || '').localeCompare(String(a.matchId || ''));
  });
}

function takeRecentSoccerMatches(matches: SoccerwayRecentMatch[], limit = INITIAL_RECENT_MATCHES_LIMIT): SoccerwayRecentMatch[] {
  if (matches.length <= limit) return matches;
  return sortSoccerMatchesByRecency(matches).slice(0, limit);
}

function formatFixtureStageLabel(value: string | null | undefined): string | null {
  let stage = String(value || '').trim();
  if (!stage) return null;

  if (stage.includes(' - ')) {
    stage = stage.split(' - ').map((part) => part.trim()).filter(Boolean).at(-1) || stage;
  }

  const roundNumber = stage.match(/^round\s+(\d+)$/i);
  if (roundNumber) return `RD ${roundNumber[1]}`;

  const roundOf = stage.match(/^round of\s+(\d+)$/i);
  if (roundOf) return `RD ${roundOf[1]}`;

  if (/semi-finals?/i.test(stage)) return 'Semi Final';
  if (/quarter-finals?/i.test(stage)) return 'Quarter Final';
  if (/finals?/i.test(stage)) return 'Final';

  return stage;
}

function SoccerWinPercentageWheel({
  isDark,
  winPercentage,
  size = 100,
}: {
  isDark: boolean;
  winPercentage: number | null;
  size?: number;
}) {
  if (winPercentage == null) return null;

  const clampedWinPercentage = Math.max(0, Math.min(100, winPercentage));
  const radius = size / 2 - 14;
  const strokeWidth = 8;
  const centerX = size / 2;
  const centerY = size / 2;
  const startAngle = 270;
  const winAngle = (clampedWinPercentage / 100) * 360;
  const percentFontSize = size <= 90 ? 'text-sm' : 'text-lg';
  const labelFontSize = size <= 90 ? 'text-[9px]' : 'text-[10px]';

  const createArcPath = (startAngleDeg: number, endAngleDeg: number) => {
    const startAngleRad = (startAngleDeg * Math.PI) / 180;
    const endAngleRad = (endAngleDeg * Math.PI) / 180;
    const x1 = centerX + radius * Math.cos(startAngleRad);
    const y1 = centerY + radius * Math.sin(startAngleRad);
    const x2 = centerX + radius * Math.cos(endAngleRad);
    const y2 = centerY + radius * Math.sin(endAngleRad);
    const largeArcFlag = endAngleDeg - startAngleDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`;
  };

  return (
    <div className="flex items-center justify-center" aria-label={`Win percentage ${clampedWinPercentage.toFixed(1)}%`}>
      <svg width={size} height={size} className="transform -rotate-90">
        <g>
          <circle
            cx={centerX}
            cy={centerY}
            r={radius}
            fill="none"
            stroke={isDark ? '#374151' : '#e5e7eb'}
            strokeWidth={strokeWidth}
          />
          <path
            d={createArcPath(startAngle, startAngle + winAngle)}
            fill="none"
            stroke="#10b981"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
          />
          <path
            d={createArcPath(startAngle + winAngle, startAngle + 360)}
            fill="none"
            stroke="#ef4444"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
          />
          <g transform={`rotate(90 ${centerX} ${centerY})`}>
            <text
              x={centerX}
              y={centerY - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              className={`${percentFontSize} font-semibold ${isDark ? 'fill-white' : 'fill-gray-900'}`}
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              {clampedWinPercentage.toFixed(1)}%
            </text>
            <text
              x={centerX}
              y={centerY + 12}
              textAnchor="middle"
              dominantBaseline="middle"
              className={`${labelFontSize} ${isDark ? 'fill-gray-400' : 'fill-gray-600'}`}
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              Win
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}

function SoccerPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { theme, setTheme, isDark } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  const [isPro, setIsPro] = useState(false);
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  const [propsMode, setPropsMode] = useState<'player' | 'team'>('team');

  const [data, setData] = useState<SoccerDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<SoccerTeamRow | null>(null);
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [playerSearchOpen, setPlayerSearchOpen] = useState(false);
  const [selectedSoccerPlayer, setSelectedSoccerPlayer] = useState<SoccerPlayerOption | null>(null);
  /** Until roster resolves, feed chart from session so player-props fetch runs immediately on refresh. */
  const [chartBootstrapPlayer, setChartBootstrapPlayer] = useState<{ playerKey: string; displayName: string } | null>(
    null
  );
  const [recentMatches, setRecentMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [allRecentMatches, setAllRecentMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [recentMatchesLoading, setRecentMatchesLoading] = useState(false);
  const [recentMatchesError, setRecentMatchesError] = useState<string | null>(null);
  const [recentMatchesCacheMiss, setRecentMatchesCacheMiss] = useState(false);
  const [recentMatchesSettled, setRecentMatchesSettled] = useState(false);
  const [nextFixture, setNextFixture] = useState<SoccerNextFixture | null>(null);
  const [nextFixtureLoading, setNextFixtureLoading] = useState(false);
  const [nextFixtureError, setNextFixtureError] = useState<string | null>(null);
  const [nextFixtureCacheMiss, setNextFixtureCacheMiss] = useState(false);
  const [nextFixtureCountdown, setNextFixtureCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [predictedLineup, setPredictedLineup] = useState<SoccerwayLineupBundle | null>(null);
  const [predictedLineupFrom, setPredictedLineupFrom] = useState<'upcoming' | 'previous'>('upcoming');
  const [predictedLineupLoading, setPredictedLineupLoading] = useState(false);
  const [predictedLineupError, setPredictedLineupError] = useState<string | null>(null);
  const [predictedLineupCacheMiss, setPredictedLineupCacheMiss] = useState(false);
  const [cachedSoccerPlayerRoster, setCachedSoccerPlayerRoster] = useState<CachedSoccerRosterRow[]>([]);
  const [globalCachedPlayers, setGlobalCachedPlayers] = useState<CachedSoccerRosterRow[]>([]);
  const [globalCachedPlayersLoading, setGlobalCachedPlayersLoading] = useState(false);
  const [soccerOddsMarkets, setSoccerOddsMarkets] = useState<SoccerOddsMarket[]>([]);
  const [mainChartStat, setMainChartStat] = useState('');
  const [playerPropsChartSnapshot, setPlayerPropsChartSnapshot] = useState<SoccerPlayerPropsChartSnapshot | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<SoccerTimeframe>('last10');
  const [chartTeamScope, setChartTeamScope] = useState<SoccerStatTeamScope>('all');
  const [chartCompetition, setChartCompetition] = useState('all');
  const teamSearchWrapRef = useRef<HTMLDivElement>(null);
  const playerSearchWrapRef = useRef<HTMLDivElement>(null);
  const teamResultsRequestId = useRef(0);
  const nextFixtureRequestId = useRef(0);
  const predictedLineupRequestId = useRef(0);
  const playerRosterFetchedForHrefRef = useRef<string>('');
  const rosterPlayerStatsFetchSettledRef = useRef(false);
  const lineupPickPendingRef = useRef<{ teamHref: string; playerKey: string; displayName: string } | null>(null);
  const prevPropsModeRef = useRef<'player' | 'team' | null>(null);

  const { containerStyle, innerContainerStyle, innerContainerClassName, mainContentClassName, mainContentStyle } =
    useDashboardStyles({ sidebarOpen });

  const displayedRecentMatches = allRecentMatches.length > 0 ? allRecentMatches : recentMatches;

  const emptyText = mounted && isDark ? 'text-gray-500' : 'text-gray-400';
  const mainChartLoading = recentMatchesLoading || !recentMatchesSettled;
  const syncedStatsLoading = Boolean(selectedTeam) && mainChartLoading;
  const syncedFixtureStatsLoading = Boolean(selectedTeam) && (mainChartLoading || nextFixtureLoading);
  /** In player props the main chart is player-scoped; do not block lineup on team-results fetch. */
  const syncedLineupLoading =
    Boolean(selectedTeam) &&
    (propsMode === 'player' ? predictedLineupLoading : mainChartLoading || predictedLineupLoading);
  const showFixtureDependentSkeleton = Boolean(selectedTeam) && !nextFixture && nextFixtureLoading;
  /** Right-column panels: in player mode do not wait on fixture skeleton (they own loading); game mode stays synced. */
  const fixtureGatedPanelSkeleton = propsMode === 'team' && showFixtureDependentSkeleton;

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem('oddsFormat');
      if (stored === 'american' || stored === 'decimal') {
        setOddsFormat(stored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const checkSubscription = async () => {
      const {
        data: { user: verifiedUser },
      } = await supabase.auth.getUser();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = verifiedUser ?? session?.user ?? null;

      if (!user) {
        if (isMounted) {
          setIsPro(false);
          setUsername(null);
          setUserEmail(null);
          setAvatarUrl(null);
          setSubscriptionChecked(true);
          setTimeout(() => {
            router.push('/login?redirect=/soccer');
          }, 0);
        }
        return;
      }

      try {
        const { profile: p, isPro: pro } = await fetchProfileProStatusWithRetries(supabase, user);
        if (!isMounted) return;
        setUserEmail(user.email ?? null);
        setUsername(p?.full_name || p?.username || user.user_metadata?.username || user.user_metadata?.full_name || null);
        setAvatarUrl(p?.avatar_url ?? user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null);
        setIsPro(pro);
        setSubscriptionChecked(true);
      } catch (e) {
        console.error('Soccer page: profile load failed', e);
        if (isMounted) {
          setUserEmail(user.email ?? null);
          setUsername(user.user_metadata?.username || user.user_metadata?.full_name || null);
          setAvatarUrl(user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null);
          setIsPro(isProFromUserMetadata(user));
          setSubscriptionChecked(true);
        }
      }
    };
    void checkSubscription();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          setIsPro(false);
          setUsername(null);
          setUserEmail(null);
          setAvatarUrl(null);
          setSubscriptionChecked(true);
          router.push('/login?redirect=/soccer');
        }
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && isMounted && session?.user) {
        void checkSubscription();
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (subscriptionChecked && !isPro) {
      router.replace('/home#pricing');
    }
  }, [subscriptionChecked, isPro, router]);

  const loadSample = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ includeTeams: '1' });
      const response = await fetch(`/api/soccer/sample?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error || 'Failed to load soccer sample');
      }
      setData(payload as SoccerDashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load soccer sample');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!subscriptionChecked || !isPro) return;
    void loadSample();
  }, [isPro, loadSample, subscriptionChecked]);

  const scrapeNote = useMemo(() => {
    if (loading) return 'Loading Soccerway sample in background…';
    if (error) return `Scrape error: ${error}`;
    const m = data?.matchSample as { generatedAt?: string; match?: { ogTitle?: string } } | null;
    if (m?.match?.ogTitle) return `Last sample: ${m.match.ogTitle}`;
    if (m?.generatedAt) return `Sample updated ${new Date(m.generatedAt).toLocaleString()}`;
    return 'Soccerway sample loaded';
  }, [loading, error, data]);

  const teamUniverse = useMemo(
    () => parseUniqueTeamsFromSample(data?.teamSample as Record<string, unknown> | undefined),
    [data?.teamSample]
  );

  const filteredTeams = useMemo(() => {
    const q = teamSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return teamUniverse.filter((t) => teamMatchesQuery(t, q)).slice(0, 24);
  }, [teamUniverse, teamSearchQuery]);

  const lineupImageByNormalizedName = useMemo(() => {
    const map = new Map<string, string>();
    const add = (name: string | null | undefined, url: string | null | undefined) => {
      const n = normalizeSoccerName(name || '');
      if (!n || !url) return;
      if (!map.has(n)) map.set(n, url);
    };
    for (const team of predictedLineup?.teams ?? []) {
      for (const player of team.starters) {
        add(player.listName || player.fieldName, player.imageUrl);
        add(player.fieldName, player.imageUrl);
      }
      for (const player of team.substitutes) {
        add(player.listName || player.fieldName, player.imageUrl);
        add(player.fieldName, player.imageUrl);
      }
    }
    return map;
  }, [predictedLineup?.teams]);

  const lineupPlayerInfoLookup = useMemo<SoccerLineupInfoLookup>(() => {
    const bySlug = new Map<string, SoccerLineupPlayerInfo>();
    const byName = new Map<string, SoccerLineupPlayerInfo>();
    const addByName = (rawName: string | null | undefined, info: SoccerLineupPlayerInfo) => {
      const n = normalizeSoccerName(rawName || '');
      if (!n || byName.has(n)) return;
      byName.set(n, info);
    };
    for (const team of predictedLineup?.teams ?? []) {
      const positionByPlayerId = new Map<string, string>();
      const sortedLines = [...team.formationLines].sort((a, b) => a.sortKey - b.sortKey);
      const countPlayersInLine = (line: typeof sortedLines[number]) =>
        line.rows.reduce((sum, row) => sum + row.players.length, 0);
      // Auto-detect direction by locating the 1-player (goalkeeper) line.
      const firstCount = sortedLines.length > 0 ? countPlayersInLine(sortedLines[0]) : 0;
      const lastCount = sortedLines.length > 0 ? countPlayersInLine(sortedLines[sortedLines.length - 1]) : 0;
      const gkAtStart = firstCount === 1 ? true : lastCount === 1 ? false : true;
      sortedLines.forEach((line, lineIdx) => {
        const pos =
          abbreviateFormationLineName(line.name) ??
          derivePositionFromFormationIndex(lineIdx, sortedLines.length, gkAtStart);
        if (!pos) return;
        for (const row of line.rows) {
          for (const p of row.players) {
            if (p.id && !positionByPlayerId.has(p.id)) positionByPlayerId.set(p.id, pos);
          }
        }
      });
      const register = (player: SoccerwayLineupPlayer, fallbackPosition: string | null) => {
        const slug = extractSoccerwayPlayerSlugFromParticipantUrl(player.participantUrl);
        const info: SoccerLineupPlayerInfo = {
          number: player.number,
          position: positionByPlayerId.get(player.id) ?? fallbackPosition,
        };
        if (slug && !bySlug.has(slug)) bySlug.set(slug, info);
        addByName(player.listName, info);
        addByName(player.fieldName, info);
      };
      for (const player of team.starters) register(player, null);
      for (const player of team.substitutes) register(player, 'SUB');
    }
    return { bySlug, byName };
  }, [predictedLineup?.teams]);

  const teamNameByHref = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teamUniverse) {
      const href = normalizeTeamHref(team.href);
      if (href) map.set(href, team.name);
    }
    return map;
  }, [teamUniverse]);

  const playerRosterForLookup = useMemo(() => {
    const byKey = new Map<string, CachedSoccerRosterRow>();
    for (const row of globalCachedPlayers) {
      if (!row.playerKey || !row.displayName) continue;
      const teamHref = normalizeTeamHref(row.teamHref ?? '');
      byKey.set(`${teamHref}:${row.playerKey}`, { ...row, teamHref: teamHref || row.teamHref });
    }
    const selectedHref = normalizeTeamHref(selectedTeam?.href ?? '');
    for (const row of cachedSoccerPlayerRoster) {
      if (!row.playerKey || !row.displayName || !selectedHref) continue;
      byKey.set(`${selectedHref}:${row.playerKey}`, { ...row, teamHref: selectedHref });
    }
    return [...byKey.values()];
  }, [globalCachedPlayers, cachedSoccerPlayerRoster, selectedTeam?.href]);

  const searchableCachedPlayers = useMemo(() => {
    if (globalCachedPlayers.length > 0) {
      return globalCachedPlayers.filter((row) => row.playerKey && row.displayName && row.matchCount > 0);
    }
    return cachedSoccerPlayerRoster.filter((row) => row.playerKey && row.displayName && row.matchCount > 0);
  }, [globalCachedPlayers, cachedSoccerPlayerRoster]);

  const soccerPlayerUniverse = useMemo(() => {
    const selectedHref = normalizeTeamHref(selectedTeam?.href ?? '');
    const selectedTeamName = selectedTeam?.name ?? '';
    return searchableCachedPlayers
      .map((row) => {
        const rowTeamHref = normalizeTeamHref(row.teamHref ?? selectedHref);
        const rowTeamName = teamNameByHref.get(rowTeamHref) ?? (rowTeamHref === selectedHref ? selectedTeamName : '');
        const parts = row.displayName.trim().split(/\s+/).filter(Boolean);
        const shortName =
          parts.length >= 2
            ? `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase() || row.displayName.slice(0, 3)
            : row.displayName.slice(0, 3);
        const norm = normalizeSoccerName(row.displayName);
        const matchCount = row.matchCount > 0 ? row.matchCount : 0;
        const info = lookupSoccerLineupPlayerInfo(lineupPlayerInfoLookup, row.playerKey, row.displayName);
        return {
          id: row.playerKey,
          name: row.displayName,
          shortName,
          teamName: rowTeamName,
          teamHref: rowTeamHref || null,
          number: info?.number ?? null,
          imageUrl: lineupImageByNormalizedName.get(norm) ?? null,
          role: row.position ?? info?.position ?? null,
          status: matchCount > 0 ? ('cached' as const) : ('test' as const),
          cachedMatchCount: matchCount > 0 ? matchCount : undefined,
        };
      })
      .sort((a, b) => {
        const ac = a.cachedMatchCount ?? 0;
        const bc = b.cachedMatchCount ?? 0;
        if (bc !== ac) return bc - ac;
        return a.name.localeCompare(b.name);
      });
  }, [
    searchableCachedPlayers,
    selectedTeam?.href,
    selectedTeam?.name,
    teamNameByHref,
    lineupImageByNormalizedName,
    lineupPlayerInfoLookup,
  ]);

  const filteredSoccerPlayers = useMemo(() => {
    const q = foldSoccerPlayerSearchText(playerSearchQuery);
    const source = soccerPlayerUniverse;
    if (!q) return source.slice(0, 48);
    return source
      .filter((player) => {
        const haystack = foldSoccerPlayerSearchText(
          `${player.name} ${player.shortName} ${player.teamName} ${player.role ?? ''} ${player.id}`
        );
        return haystack.includes(q);
      })
      .slice(0, 48);
  }, [playerSearchQuery, soccerPlayerUniverse]);

  useEffect(() => {
    if (propsMode !== 'player') return;
    let cancelled = false;
    setGlobalCachedPlayersLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/soccer/cached-players-index', { cache: 'no-store' });
        const data = (await res.json().catch(() => null)) as {
          success?: boolean;
          players?: Array<{
            playerKey?: string;
            displayName?: string;
            matchCount?: number;
            teamHref?: string;
            position?: string | null;
          }>;
        } | null;
        if (!res.ok || !data?.success || !Array.isArray(data.players)) {
          if (!cancelled) setGlobalCachedPlayers([]);
          return;
        }
        const list = data.players
          .map((p) => ({
            playerKey: String(p.playerKey || '').trim().toLowerCase(),
            displayName: String(p.displayName || '').trim(),
            matchCount: Number(p.matchCount) || 0,
            teamHref: normalizeTeamHref(String(p.teamHref || '')),
            position: String(p.position || '').trim() || null,
          }))
          .filter((p) => p.playerKey && p.displayName && p.teamHref && p.matchCount > 0);
        if (!cancelled) setGlobalCachedPlayers(list);
      } catch {
        if (!cancelled) setGlobalCachedPlayers([]);
      } finally {
        if (!cancelled) setGlobalCachedPlayersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propsMode]);

  useEffect(() => {
    if (propsMode !== 'player') return;
    const href = normalizeTeamHref(selectedTeam?.href ?? '');
    if (!href) {
      setCachedSoccerPlayerRoster([]);
      playerRosterFetchedForHrefRef.current = '';
      rosterPlayerStatsFetchSettledRef.current = false;
      return;
    }
    if (playerRosterFetchedForHrefRef.current !== href) {
      setCachedSoccerPlayerRoster([]);
      playerRosterFetchedForHrefRef.current = href;
      rosterPlayerStatsFetchSettledRef.current = false;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/soccer/player-stats-roster-report?href=${encodeURIComponent(href)}&limit=0&categories=all&season=current`,
          { cache: 'no-store' }
        );
        const data = (await res.json().catch(() => null)) as {
          success?: boolean;
          players?: Array<{ playerKey?: string; displayName?: string; matchCount?: number }>;
        } | null;
        if (!res.ok || !data?.success || !Array.isArray(data.players)) {
          if (!cancelled) setCachedSoccerPlayerRoster([]);
          return;
        }
        const list = data.players
          .map((p) => ({
            playerKey: String(p.playerKey || '').trim().toLowerCase(),
            displayName: String(p.displayName || '').trim(),
            matchCount: Number(p.matchCount) || 0,
            teamHref: href,
          }))
          .filter((p) => p.playerKey && p.displayName);
        if (!cancelled) setCachedSoccerPlayerRoster(list);
      } catch {
        if (!cancelled) setCachedSoccerPlayerRoster([]);
      } finally {
        if (!cancelled) rosterPlayerStatsFetchSettledRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propsMode, selectedTeam?.href]);

  const teamHrefFromUrl = normalizeTeamHref(searchParams.get('team'));
  const propsFromUrl = (searchParams.get('props') ?? '').trim().toLowerCase();
  const selectedTeamHref = normalizeTeamHref(selectedTeam?.href);

  useLayoutEffect(() => {
    if (propsFromUrl === 'player') {
      setPropsMode('player');
    }
    if (!teamHrefFromUrl) {
      setChartBootstrapPlayer(null);
      return;
    }
    const cached = readSoccerDashboardSessionState(teamHrefFromUrl);
    if (!cached) {
      setChartBootstrapPlayer(null);
      return;
    }
    const cachedVisibleMatches = takeRecentSoccerMatches(cached.recentMatches);
    const sessionPlayer = cached.playerProps;

    setSelectedTeam((prev) => {
      if (normalizeTeamHref(prev?.href) === cached.team.href) return prev;
      return {
        name: cached.team.name,
        href: cached.team.href,
        competitions: [],
      };
    });
    setTeamSearchQuery((prev) => prev || cached.team.name);
    setRecentMatches((prev) => (prev.length > 0 ? prev : cachedVisibleMatches));
    setAllRecentMatches((prev) => (prev.length > 0 ? prev : cached.recentMatches));
    setNextFixture((prev) => prev ?? cached.nextFixture ?? null);
    setNextFixtureError(null);
    setNextFixtureCacheMiss(false);
    setNextFixtureLoading(false);
    setRecentMatchesError(null);
    setRecentMatchesCacheMiss(false);
    setRecentMatchesSettled(true);

    if (sessionPlayer?.playerKey) {
      setPropsMode('player');
      setPlayerSearchQuery(sessionPlayer.displayName);
      setChartBootstrapPlayer({
        playerKey: sessionPlayer.playerKey,
        displayName: sessionPlayer.displayName,
      });
      lineupPickPendingRef.current = {
        teamHref: normalizeTeamHref(cached.team.href),
        playerKey: sessionPlayer.playerKey,
        displayName: sessionPlayer.displayName,
      };
      setSelectedSoccerPlayer(null);
    } else {
      setChartBootstrapPlayer(null);
      if (propsFromUrl !== 'player') {
        setPropsMode('team');
      }
    }
  }, [teamHrefFromUrl, propsFromUrl]);

  useLayoutEffect(() => {
    const raw = selectedTeam?.href;
    if (!raw) return;
    const href = raw.startsWith('/') ? raw : `/${raw}`;
    const snap = readLineupUiSnap(href);
    if (!snap) return;
    setPredictedLineup(snap.lineup);
    setPredictedLineupFrom(snap.lineupFrom);
    setPredictedLineupLoading(false);
  }, [selectedTeam?.href]);

  useEffect(() => {
    if (!teamHrefFromUrl) return;
    const current = (searchParams.get('props') ?? '').trim().toLowerCase();
    if (propsMode === 'player' && current !== 'player') {
      const params = new URLSearchParams(searchParams.toString());
      params.set('props', 'player');
      const next = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(next, { scroll: false });
      return;
    }
    if (propsMode === 'team' && current === 'player') {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('props');
      const next = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(next, { scroll: false });
    }
  }, [pathname, propsMode, router, searchParams, teamHrefFromUrl]);

  const updateTeamUrl = useCallback(
    (teamHref: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      const normalizedHref = normalizeTeamHref(teamHref);
      if (normalizedHref) params.set('team', normalizedHref);
      else params.delete('team');
      const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handlePlayerPropsChartSnapshot = useCallback((snapshot: SoccerPlayerPropsChartSnapshot) => {
    setPlayerPropsChartSnapshot(snapshot);
  }, []);

  const handleLineupPlayerClick = useCallback(
    ({ player, teamName }: { player: SoccerwayLineupPlayer; teamName: string }) => {
      const matchedTeam =
        teamUniverse.find((t) => normalizeSoccerName(t.name) === normalizeSoccerName(teamName)) ?? null;
      if (!matchedTeam?.href) return;

      const teamHrefNorm = normalizeTeamHref(matchedTeam.href);
      const slug = extractSoccerwayPlayerSlugFromParticipantUrl(player.participantUrl) ?? '';
      const displayName = (player.listName || player.fieldName).trim() || slug;

      setSelectedTeam(matchedTeam);
      setTeamSearchQuery(matchedTeam.name);
      updateTeamUrl(matchedTeam.href);
      setPropsMode('player');
      setPlayerSearchOpen(true);

      const currentHref = normalizeTeamHref(selectedTeam?.href ?? '');
      if (currentHref === teamHrefNorm) {
        const row = findCachedRosterRowForLineupPlayer(playerRosterForLookup, player, teamHrefNorm);
        if (row) {
          setSelectedSoccerPlayer(buildSoccerPlayerOptionFromRosterRow(row, matchedTeam, lineupImageByNormalizedName, lineupPlayerInfoLookup));
          setPlayerSearchQuery(row.displayName);
          lineupPickPendingRef.current = null;
          return;
        }
      }

      lineupPickPendingRef.current = {
        teamHref: teamHrefNorm,
        playerKey: slug,
        displayName: displayName || slug,
      };
      setSelectedSoccerPlayer(null);
      setPlayerSearchQuery(displayName || slug);
    },
    [playerRosterForLookup, lineupImageByNormalizedName, lineupPlayerInfoLookup, selectedTeam?.href, teamUniverse, updateTeamUrl]
  );

  useEffect(() => {
    const pending = lineupPickPendingRef.current;
    if (!pending) return;
    if (normalizeTeamHref(selectedTeam?.href ?? '') !== pending.teamHref) {
      lineupPickPendingRef.current = null;
    }
  }, [selectedTeam?.href]);

  useEffect(() => {
    const pending = lineupPickPendingRef.current;
    if (!pending || propsMode !== 'player') return;
    const href = normalizeTeamHref(selectedTeam?.href ?? '');
    if (href !== pending.teamHref || !selectedTeam) return;

    if (playerRosterForLookup.length === 0) {
      if (globalCachedPlayersLoading || !rosterPlayerStatsFetchSettledRef.current) return;
      lineupPickPendingRef.current = null;
      return;
    }

    const row =
      findCachedRosterRowFromLineupPick(
        playerRosterForLookup.filter((r) => !r.teamHref || normalizeTeamHref(r.teamHref) === href),
        pending
      ) ?? findCachedRosterRowFromLineupPick(playerRosterForLookup, pending);
    if (row) {
      setSelectedSoccerPlayer(buildSoccerPlayerOptionFromRosterRow(row, selectedTeam, lineupImageByNormalizedName, lineupPlayerInfoLookup));
      setPlayerSearchQuery(row.displayName);
      lineupPickPendingRef.current = null;
      return;
    }

    lineupPickPendingRef.current = null;
  }, [
    globalCachedPlayersLoading,
    lineupImageByNormalizedName,
    lineupPlayerInfoLookup,
    playerRosterForLookup,
    propsMode,
    selectedTeam,
  ]);

  useEffect(() => {
    if (teamUniverse.length === 0) return;
    if (!teamHrefFromUrl) return;
    if (readSoccerDashboardSessionState(teamHrefFromUrl)?.playerProps?.playerKey) return;

    const matchedTeam = teamUniverse.find((team) => normalizeTeamHref(team.href) === teamHrefFromUrl) ?? null;
    if (!matchedTeam) return;
    if (selectedTeamHref === teamHrefFromUrl) return;

    if (propsFromUrl !== 'player') {
      setPropsMode('team');
    }
    setSelectedTeam(matchedTeam);
    setTeamSearchQuery(matchedTeam.name);
  }, [propsFromUrl, selectedTeam, selectedTeamHref, teamHrefFromUrl, teamUniverse]);

  useEffect(() => {
    if (propsMode !== 'player') return;
    if (!selectedSoccerPlayer) return;
    // Roster can be empty briefly after toggling back from game props; keep selection until list exists.
    if (soccerPlayerUniverse.length === 0) return;
    const validIds = new Set(soccerPlayerUniverse.map((p) => p.id));
    if (validIds.has(selectedSoccerPlayer.id)) return;
    setSelectedSoccerPlayer(null);
    setPlayerSearchQuery('');
  }, [propsMode, selectedSoccerPlayer, soccerPlayerUniverse]);

  useEffect(() => {
    const prev = prevPropsModeRef.current;
    if (prev === 'player' && propsMode === 'team') {
      lineupPickPendingRef.current = null;
      const href = normalizeTeamHref(selectedTeam?.href ?? '');
      if (href && selectedTeam?.name.trim() && readSoccerDashboardSessionState(href)) {
        writeSoccerDashboardSessionState({ name: selectedTeam.name, href }, { playerProps: null });
      }
    }
    prevPropsModeRef.current = propsMode;

    const href = normalizeTeamHref(selectedTeam?.href ?? '');
    if (!href || !selectedTeam?.name.trim()) return;
    if (!readSoccerDashboardSessionState(href)) return;
    if (propsMode !== 'player' || !selectedSoccerPlayer?.id) return;
    const pk = selectedSoccerPlayer.id.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,80}$/.test(pk)) return;
    const dn = selectedSoccerPlayer.name.trim();
    if (!dn) return;
    writeSoccerDashboardSessionState({ name: selectedTeam.name, href }, { playerProps: { playerKey: pk, displayName: dn } });
  }, [propsMode, selectedSoccerPlayer?.id, selectedSoccerPlayer?.name, selectedTeam?.href, selectedTeam?.name]);

  useEffect(() => {
    if (propsMode !== 'player') {
      setChartBootstrapPlayer(null);
    }
  }, [propsMode]);

  useEffect(() => {
    const id = selectedSoccerPlayer?.id?.trim().toLowerCase();
    if (!id) return;
    setChartBootstrapPlayer((prev) => (prev && prev.playerKey === id ? null : prev));
  }, [selectedSoccerPlayer?.id]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const el = teamSearchWrapRef.current;
      const playerEl = playerSearchWrapRef.current;
      if (el && teamSearchOpen && e.target instanceof Node && !el.contains(e.target)) {
        setTeamSearchOpen(false);
      }
      if (playerEl && playerSearchOpen && e.target instanceof Node && !playerEl.contains(e.target)) {
        setPlayerSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [playerSearchOpen, teamSearchOpen]);

  useEffect(() => {
    if (!selectedTeam) {
      setRecentMatches([]);
      setAllRecentMatches([]);
      setRecentMatchesError(null);
      setRecentMatchesCacheMiss(false);
      setRecentMatchesLoading(false);
      setRecentMatchesSettled(false);
      return;
    }

    const requestId = (teamResultsRequestId.current += 1);
    const ac = new AbortController();
    const requestStartedAt = Date.now();
    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    const cached = readSoccerDashboardSessionState(href);
    const cachedMatches = Array.isArray(cached?.recentMatches) ? cached.recentMatches : [];
    const initialCachedMatches = takeRecentSoccerMatches(cachedMatches);
    const hasCachedMatches = cachedMatches.length > 0;
    const hasFullCachedMatches = cachedMatches.length > initialCachedMatches.length;
    const cachedLatestMatchKey =
      cachedMatches[0] != null ? `${String(cachedMatches[0].matchId || '')}:${String(cachedMatches[0].summaryPath || '')}` : '';
    const waitWithAbort = async (delayMs: number) => {
      if (delayMs <= 0) return;
      await new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(() => resolve(), delayMs);
        ac.signal.addEventListener(
          'abort',
          () => {
            window.clearTimeout(timeoutId);
            resolve();
          },
          { once: true }
        );
      });
    };
    const fetchCachedTeamResults = async (options?: { limitMatches?: number }) => {
      const params = new URLSearchParams({ href, cacheOnly: '1' });
      if (options?.limitMatches) params.set('limitMatches', String(options.limitMatches));
      const response = await fetch(`/api/soccer/team-results?${params.toString()}`, {
        signal: ac.signal,
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        matches?: SoccerwayRecentMatch[];
        totalCount?: number;
        hasMore?: boolean;
        cache?: { teamResultsSource?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load recent matches');
      }
      return payload;
    };
    const waitForEmptyStateSkeleton = async () => {
      if (hasCachedMatches) return;
      const remainingMs = Math.max(0, EMPTY_STATS_SKELETON_MS - (Date.now() - requestStartedAt));
      await waitWithAbort(remainingMs);
    };

    if (hasCachedMatches) {
      setRecentMatches(initialCachedMatches);
      setAllRecentMatches(cachedMatches);
      setRecentMatchesCacheMiss(false);
      setRecentMatchesLoading(false);
      setRecentMatchesSettled(true);
    } else {
      setRecentMatchesLoading(true);
      setRecentMatchesSettled(false);
    }
    setRecentMatchesError(null);

    void fetchCachedTeamResults({ limitMatches: INITIAL_RECENT_MATCHES_LIMIT })
      .then(async (response) => {
        let payload = response;
        let matches = Array.isArray(payload?.matches) ? payload.matches : [];
        let totalCount = Number(payload?.totalCount || matches.length);
        let hasMore = Boolean(payload?.hasMore);
        let source = payload?.cache?.teamResultsSource ?? null;

        while (
          !hasCachedMatches &&
          !ac.signal.aborted &&
          (source === 'cache-miss' || matches.length === 0) &&
          Date.now() - requestStartedAt < EMPTY_STATS_SKELETON_MS
        ) {
          await waitWithAbort(EMPTY_STATS_CACHE_RETRY_DELAY_MS);
          if (ac.signal.aborted) break;
          payload = await fetchCachedTeamResults({ limitMatches: INITIAL_RECENT_MATCHES_LIMIT });
          matches = Array.isArray(payload?.matches) ? payload.matches : [];
          totalCount = Number(payload?.totalCount || matches.length);
          hasMore = Boolean(payload?.hasMore);
          source = payload?.cache?.teamResultsSource ?? null;
        }

        const shouldDelayEmptyState = matches.length === 0;

        if (shouldDelayEmptyState && !ac.signal.aborted) {
          await waitForEmptyStateSkeleton();
        }

        if (teamResultsRequestId.current !== requestId) return;
        setRecentMatchesCacheMiss(source === 'cache-miss');
        setRecentMatches(takeRecentSoccerMatches(matches));
        if (matches.length > 0) {
          const latestFetchedMatchKey =
            matches[0] != null ? `${String(matches[0].matchId || '')}:${String(matches[0].summaryPath || '')}` : '';
          const shouldRefreshFullCachedMatches =
            (hasMore || totalCount > matches.length) &&
            (!hasFullCachedMatches || totalCount !== cachedMatches.length || latestFetchedMatchKey !== cachedLatestMatchKey);

          if (!hasMore || totalCount <= matches.length) {
            setAllRecentMatches(matches);
            writeSoccerDashboardSessionState({ name: selectedTeam.name, href }, { recentMatches: matches });
          } else if (!hasCachedMatches) {
            setAllRecentMatches([]);
          }

          if (shouldRefreshFullCachedMatches) {
            void fetchCachedTeamResults()
              .then((fullPayload) => {
                if (ac.signal.aborted) return;
                if (teamResultsRequestId.current !== requestId) return;
                const fullMatches = Array.isArray(fullPayload?.matches) ? fullPayload.matches : [];
                if (fullMatches.length <= matches.length) return;
                setAllRecentMatches(fullMatches);
                writeSoccerDashboardSessionState({ name: selectedTeam.name, href }, { recentMatches: fullMatches });
              })
              .catch(() => undefined);
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (teamResultsRequestId.current !== requestId) return;
        setRecentMatchesCacheMiss(false);
        if (!hasCachedMatches) {
          setRecentMatches([]);
          setAllRecentMatches([]);
          setRecentMatchesError(err instanceof Error ? err.message : 'Failed to load recent matches');
        }
      })
      .finally(() => {
        if (teamResultsRequestId.current === requestId) {
          setRecentMatchesLoading(false);
          setRecentMatchesSettled(true);
        }
      });

    return () => ac.abort();
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeam) {
      setNextFixture(null);
      setNextFixtureError(null);
      setNextFixtureCacheMiss(false);
      setNextFixtureLoading(false);
      return;
    }

    const requestId = (nextFixtureRequestId.current += 1);
    const ac = new AbortController();
    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    const cached = readSoccerDashboardSessionState(href);
    const cachedFixture = cached?.nextFixture ?? null;
    setNextFixture(cachedFixture);
    setNextFixtureLoading(!cachedFixture);
    setNextFixtureError(null);
    setNextFixtureCacheMiss(false);
    void fetch(`/api/soccer/next-game?href=${encodeURIComponent(href)}&cacheOnly=1`, { signal: ac.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          fixture?: SoccerNextFixture | null;
          cache?: { source?: string };
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load next fixture');
        }
        if (nextFixtureRequestId.current !== requestId) return;
        setNextFixtureCacheMiss(payload?.cache?.source === 'cache-miss');
        setNextFixture(payload?.fixture ?? null);
        writeSoccerDashboardSessionState(
          { name: selectedTeam.name, href },
          { nextFixture: payload?.fixture ?? null }
        );
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (nextFixtureRequestId.current !== requestId) return;
        if (!cachedFixture) {
          setNextFixture(null);
          setNextFixtureCacheMiss(false);
          setNextFixtureError(err instanceof Error ? err.message : 'Failed to load next fixture');
        }
      })
      .finally(() => {
        if (nextFixtureRequestId.current === requestId) {
          setNextFixtureLoading(false);
        }
      });

    return () => ac.abort();
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeam) {
      setPredictedLineup(null);
      setPredictedLineupFrom('upcoming');
      setPredictedLineupError(null);
      setPredictedLineupCacheMiss(false);
      setPredictedLineupLoading(false);
      return;
    }

    const requestId = (predictedLineupRequestId.current += 1);
    const ac = new AbortController();
    const href = selectedTeam.href.startsWith('/') ? selectedTeam.href : `/${selectedTeam.href}`;
    const lineupSnap = readLineupUiSnap(href);
    if (lineupSnap) {
      setPredictedLineup(lineupSnap.lineup);
      setPredictedLineupFrom(lineupSnap.lineupFrom);
      setPredictedLineupLoading(false);
    } else {
      setPredictedLineupLoading(true);
    }
    setPredictedLineupError(null);
    setPredictedLineupCacheMiss(false);
    if (!lineupSnap) {
      setPredictedLineupFrom('upcoming');
    }

    void fetch(`/api/soccer/predicted-lineup?href=${encodeURIComponent(href)}&cacheOnly=1`, {
      signal: ac.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | (SoccerPredictedLineupResponse & { error?: string; cache?: { source?: string } })
          | null;
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load lineup');
        }

        if (predictedLineupRequestId.current !== requestId) return;
        setPredictedLineupCacheMiss(payload?.cache?.source === 'cache-miss');
        const from = payload?.lineupFrom === 'previous' ? 'previous' : 'upcoming';
        setPredictedLineupFrom(from);
        const lineup = payload?.lineup ?? null;
        setPredictedLineup(lineup);
        writeLineupUiSnap(href, { lineup, lineupFrom: from });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (predictedLineupRequestId.current !== requestId) return;
        if (!readLineupUiSnap(href)) {
          setPredictedLineup(null);
        }
        setPredictedLineupCacheMiss(false);
        setPredictedLineupError(err instanceof Error ? err.message : 'Failed to load lineup');
      })
      .finally(() => {
        if (predictedLineupRequestId.current === requestId) {
          setPredictedLineupLoading(false);
        }
      });

    return () => ac.abort();
  }, [selectedTeam]);

  useEffect(() => {
    const href = String(selectedTeamHref || '').trim();
    const matchId = String(nextFixture?.matchId || '').trim();
    if (!href || !matchId) {
      setSoccerOddsMarkets([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ href, matchId });

    fetch(`/api/soccer/odds?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
          groupedMarkets?: SoccerOddsMarket[];
        } | null;
        if (!response.ok || json?.success === false) {
          throw new Error(json?.error || `Soccer odds request failed (${response.status})`);
        }
        return json;
      })
      .then((json) => {
        if (!cancelled) setSoccerOddsMarkets(Array.isArray(json?.groupedMarkets) ? json.groupedMarkets : []);
      })
      .catch((error) => {
        if (cancelled || error?.name === 'AbortError') return;
        setSoccerOddsMarkets([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nextFixture?.matchId, selectedTeamHref]);

  const nextFixtureKickoff = useMemo(
    () => (nextFixture?.kickoffUnix != null ? new Date(nextFixture.kickoffUnix * 1000) : null),
    [nextFixture?.kickoffUnix]
  );

  useCountdownTimer({
    nextGameTipoff: nextFixtureKickoff,
    isGameInProgress: false,
    setCountdown: setNextFixtureCountdown,
  });

  const selectedHeaderTeamName = selectedTeam?.name ?? null;
  const headerTitle =
    propsMode === 'player'
      ? selectedSoccerPlayer?.name ?? 'Select a player'
      : selectedHeaderTeamName ?? 'Select a team';
  const displayOpponent = nextFixture?.opponentName?.trim() ? nextFixture.opponentName.trim() : null;
  const selectedTeamWinPercentage = useMemo(() => {
    return calculateSoccerWinPercentageFromOdds(
      soccerOddsMarkets,
      getSelectedSoccerSide(selectedHeaderTeamName, nextFixture)
    );
  }, [nextFixture, selectedHeaderTeamName, soccerOddsMarkets]);
  const nextOpponentHrefForPanel = useMemo(() => {
    if (!displayOpponent || teamUniverse.length === 0) return null;
    const normalizeToken = (value: string | null | undefined) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s*\([^)]+\)\s*/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const target = displayOpponent
      .toLowerCase()
      .replace(/\s*\([^)]+\)\s*$/g, '')
      .trim();
    const competitionToken = normalizeToken(nextFixture?.competitionName);
    const countryToken = normalizeToken(nextFixture?.competitionCountry);
    const inFixtureLeague = (t: SoccerTeamRow) =>
      t.competitions.some(
        (c) =>
          normalizeToken(c.competition) === competitionToken &&
          (!countryToken || normalizeToken(c.country) === countryToken)
      );
    const exactLeagueMatch = teamUniverse.find((t) => t.name.toLowerCase() === target && inFixtureLeague(t));
    if (exactLeagueMatch) return normalizeTeamHref(exactLeagueMatch.href);
    const fuzzyLeagueMatch = teamUniverse.find(
      (t) =>
        inFixtureLeague(t) &&
        (t.name.toLowerCase().includes(target) || (target.length >= 3 && target.includes(t.name.toLowerCase())))
    );
    if (fuzzyLeagueMatch) return normalizeTeamHref(fuzzyLeagueMatch.href);
    const anyMatch = teamUniverse.find((t) => t.name.toLowerCase() === target);
    return anyMatch ? normalizeTeamHref(anyMatch.href) : null;
  }, [displayOpponent, nextFixture?.competitionCountry, nextFixture?.competitionName, teamUniverse]);
  const fixturePrimaryName = nextFixture?.isHome === false ? displayOpponent : selectedHeaderTeamName;
  const fixtureSecondaryName = nextFixture?.isHome === false ? selectedHeaderTeamName : displayOpponent;
  const fixturePrimaryLogoUrl =
    nextFixture?.isHome === false ? nextFixture?.opponentLogoUrl ?? null : nextFixture?.teamLogoUrl ?? null;
  const fixtureSecondaryLogoUrl =
    nextFixture?.isHome === false ? nextFixture?.teamLogoUrl ?? null : nextFixture?.opponentLogoUrl ?? null;
  const fixturePrimaryAlt = nextFixture?.isHome === false ? displayOpponent ?? 'Home team' : selectedHeaderTeamName ?? 'Selected team';
  const fixtureSecondaryAlt = nextFixture?.isHome === false ? selectedHeaderTeamName ?? 'Selected team' : displayOpponent ?? 'Away team';
  const fixturePrimaryLines = splitFixtureNameLines(fixturePrimaryName);
  const fixtureSecondaryLines = splitFixtureNameLines(fixtureSecondaryName);
  const recentMatchesEmptyMessage = 'No data available come back later';
  const nextFixtureMeta = useMemo(() => {
    if (!selectedTeam) return null;
    if (nextFixtureLoading) return { primary: 'Loading next fixture...', secondary: null, isError: false };
    if (nextFixtureError) return { primary: nextFixtureError, secondary: null, isError: true };
    if (nextFixtureCacheMiss) return { primary: 'No cached upcoming fixture yet.', secondary: null, isError: false };
    if (!nextFixture) return { primary: 'No upcoming fixture found on Soccerway.', secondary: null, isError: false };

    const competition = String(nextFixture.competitionName || '').trim();
    const stage = formatFixtureStageLabel(nextFixture.competitionStage);
    const primary = [competition, stage].filter(Boolean).join(' · ') || null;

    const secondaryParts: string[] = [];
    if (nextFixtureKickoff) {
      secondaryParts.push(
        nextFixtureKickoff.toLocaleString([], {
          month: 'short',
          day: 'numeric',
        })
      );
    }
    if (nextFixture.isHome === true) secondaryParts.push('Home');
    else if (nextFixture.isHome === false) secondaryParts.push('Away');

    return {
      primary,
      secondary: secondaryParts.join(' · ') || null,
      isError: false,
    };
  }, [nextFixture, nextFixtureCacheMiss, nextFixtureError, nextFixtureKickoff, nextFixtureLoading, selectedTeam]);

  if (subscriptionChecked && !isPro) {
    return null;
  }

  return (
    <div className="min-h-screen h-screen max-h-screen bg-gray-50 dark:bg-[#050d1a] transition-colors overflow-y-auto overflow-x-hidden overscroll-contain lg:max-h-none lg:overflow-y-hidden lg:overflow-x-auto">
      <DashboardStyles />
      <div className="px-0 dashboard-container" style={containerStyle}>
        <div className={innerContainerClassName} style={innerContainerStyle}>
          <div className="pt-4 min-h-0 lg:h-full dashboard-container" style={{ paddingLeft: 0 }}>
            <DashboardLeftSidebarWrapper
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              oddsFormat={oddsFormat}
              setOddsFormat={setOddsFormat}
              hasPremium={isPro}
              avatarUrl={avatarUrl}
              username={username}
              userEmail={userEmail}
              isPro={isPro}
              onSubscriptionClick={() => router.push('/subscription')}
              onSignOutClick={async () => {
                await supabase.auth.signOut({ scope: 'local' });
                router.push('/');
              }}
              onProfileUpdated={({ username: u, avatar_url: a }) => {
                if (u !== undefined) setUsername(u ?? null);
                if (a !== undefined) setAvatarUrl(a ?? null);
              }}
              showDashboardNavLinks={false}
            />
            <div className="flex flex-col lg:flex-row gap-0 lg:gap-0 min-h-0">
              <div className={mainContentClassName} style={mainContentStyle}>
                {/* 1. Filter By — mobile */}
                <div className={`lg:hidden rounded-lg ${AFL_DASH_CARD_GLOW} px-3 md:px-4 pt-3 md:pt-4 pb-4 md:pb-5 relative overflow-visible`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                    <button
                      type="button"
                      onClick={() => setPropsMode('player')}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        propsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      type="button"
                      onClick={() => setPropsMode('team')}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border ${
                        propsMode === 'team'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Game Props
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{scrapeNote}</p>
                </div>

                {/* 2. Header — AFL shell (blank) */}
                <div
                  className={`relative z-[60] rounded-lg ${AFL_DASH_CARD_GLOW} px-2.5 py-2 sm:px-4 sm:py-3 md:px-5 md:py-3.5 w-full min-w-0 flex-shrink-0 mr-0 overflow-visible`}
                >
                  <div className="flex flex-col gap-1.5 lg:gap-2">
                    <div className="hidden lg:flex items-center gap-3 min-w-0">
                      <div className="flex flex-1 min-w-0 items-center">
                        <div className="flex items-center gap-2 min-w-0">
                          {propsMode === 'player' && selectedSoccerPlayer?.imageUrl ? (
                            <img
                              src={selectedSoccerPlayer.imageUrl}
                              alt={selectedSoccerPlayer.name}
                              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            />
                          ) : propsMode !== 'player' && nextFixture?.teamLogoUrl ? (
                            <img
                              src={nextFixture.teamLogoUrl}
                              alt={selectedHeaderTeamName ?? 'Selected team'}
                              className="w-6 h-6 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <h1 className="text-base md:text-lg font-bold text-gray-900 dark:text-white truncate min-w-0">{headerTitle}</h1>
                              {propsMode === 'player' && selectedSoccerPlayer?.number ? (
                                <span className="text-xs md:text-sm font-semibold text-purple-600 dark:text-purple-300 flex-shrink-0">
                                  #{selectedSoccerPlayer.number}
                                </span>
                              ) : null}
                            </div>
                            {propsMode === 'player' && selectedSoccerPlayer ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                {selectedSoccerPlayer.role
                                  ? `${selectedSoccerPlayer.role}${selectedSoccerPlayer.teamName ? ` · ${selectedSoccerPlayer.teamName}` : ''}`
                                  : selectedSoccerPlayer.teamName}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 justify-center">
                        <div className="flex flex-col items-center gap-1.5 min-w-0 flex-shrink">
                          <div className="flex items-center gap-2 xl:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 xl:px-2.5 xl:py-1.5 min-w-0 flex-shrink overflow-hidden">
                            <div className="flex flex-col items-center justify-center w-14 xl:w-[72px] min-w-0 flex-shrink-0">
                              <div className="flex items-center justify-center w-6 h-6 xl:w-8 xl:h-8 flex-shrink-0">
                                {fixturePrimaryLogoUrl ? (
                                  <img
                                    src={fixturePrimaryLogoUrl}
                                    alt={fixturePrimaryAlt}
                                    className="w-5 h-5 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                                  />
                                ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              </div>
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] xl:text-[11px] font-medium text-gray-900 dark:text-white truncate">{fixturePrimaryLines[0]}</div>
                                {fixturePrimaryLines[1] ? (
                                  <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 truncate">{fixturePrimaryLines[1]}</div>
                                ) : null}
                              </div>
                            </div>
                            {selectedHeaderTeamName && nextFixtureCountdown ? (
                              <div className="flex flex-col items-center flex-shrink-0 min-w-0 w-14 xl:w-[72px]">
                                <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Kickoff in</div>
                                <div className="text-[11px] xl:text-xs font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                                  {String(nextFixtureCountdown.hours).padStart(2, '0')}:
                                  {String(nextFixtureCountdown.minutes).padStart(2, '0')}:
                                  {String(nextFixtureCountdown.seconds).padStart(2, '0')}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400 font-medium text-xs flex-shrink-0">VS</span>
                            )}
                            <div className="flex flex-col items-center justify-center w-14 xl:w-[72px] min-w-0 flex-shrink-0">
                              {fixtureSecondaryLogoUrl ? (
                                <img
                                  src={fixtureSecondaryLogoUrl}
                                  alt={fixtureSecondaryAlt}
                                  className="w-5 h-5 xl:w-7 xl:h-7 object-contain flex-shrink-0"
                                />
                              ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] xl:text-[11px] font-medium text-gray-900 dark:text-white truncate">{fixtureSecondaryLines[0]}</div>
                                {fixtureSecondaryLines[1] ? (
                                  <div className="text-[9px] xl:text-[10px] text-gray-500 dark:text-gray-400 truncate">{fixtureSecondaryLines[1]}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          {nextFixtureMeta ? (
                            <div className={`text-[10px] xl:text-[11px] text-center w-full leading-tight ${nextFixtureMeta.isError ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-300'}`}>
                              {nextFixtureMeta.primary ? <div>{nextFixtureMeta.primary}</div> : null}
                              {nextFixtureMeta.secondary ? <div>{nextFixtureMeta.secondary}</div> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-1 min-w-0 justify-end">
                        {selectedTeamWinPercentage != null ? (
                          <div className="flex-shrink-0">
                            <SoccerWinPercentageWheel
                              isDark={Boolean(mounted && isDark)}
                              winPercentage={selectedTeamWinPercentage}
                              size={100}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="lg:hidden flex flex-col gap-0.5 relative">
                      <div className={`w-full min-w-0 ${selectedTeamWinPercentage != null ? 'pr-[5.75rem]' : ''}`}>
                        <div className="flex items-center justify-center gap-2 min-w-0">
                          <h1 className="text-base font-bold text-gray-900 dark:text-white text-center truncate min-w-0">{headerTitle}</h1>
                          {propsMode === 'player' && selectedSoccerPlayer?.number ? (
                            <span className="text-xs font-semibold text-purple-600 dark:text-purple-300 flex-shrink-0">
                              #{selectedSoccerPlayer.number}
                            </span>
                          ) : null}
                        </div>
                        {propsMode === 'player' && selectedSoccerPlayer ? (
                          <div className="text-[11px] text-gray-600 dark:text-gray-400 text-center truncate">
                            {selectedSoccerPlayer.role
                              ? `${selectedSoccerPlayer.role}${selectedSoccerPlayer.teamName ? ` · ${selectedSoccerPlayer.teamName}` : ''}`
                              : selectedSoccerPlayer.teamName}
                          </div>
                        ) : null}
                      </div>
                      {selectedTeamWinPercentage != null ? (
                        <div className="absolute right-0 -top-2 z-20 flex-shrink-0 pointer-events-auto">
                          <SoccerWinPercentageWheel
                            isDark={Boolean(mounted && isDark)}
                            winPercentage={selectedTeamWinPercentage}
                            size={85}
                          />
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-0.5 w-full min-w-0 items-center">
                        <div className="flex justify-center">
                          <div className="flex items-center gap-2 sm:gap-2.5 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-2.5 sm:py-1.5 min-w-0">
                            <div className="flex flex-col items-center justify-center w-14 sm:w-[68px] min-w-0 flex-shrink-0">
                              <div className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0">
                                {fixturePrimaryLogoUrl ? (
                                  <img
                                    src={fixturePrimaryLogoUrl}
                                    alt={fixturePrimaryAlt}
                                    className="w-5 h-5 sm:w-6 sm:h-6 object-contain flex-shrink-0"
                                  />
                                ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              </div>
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] font-medium text-gray-900 dark:text-white truncate">{fixturePrimaryLines[0]}</div>
                                {fixturePrimaryLines[1] ? (
                                  <div className="text-[9px] text-gray-500 dark:text-gray-400 truncate">{fixturePrimaryLines[1]}</div>
                                ) : null}
                              </div>
                            </div>
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs">VS</span>
                            <div className="flex flex-col items-center justify-center w-14 sm:w-[68px] min-w-0 flex-shrink-0">
                              <div className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0">
                                {fixtureSecondaryLogoUrl ? (
                                  <img
                                    src={fixtureSecondaryLogoUrl}
                                    alt={fixtureSecondaryAlt}
                                    className="w-5 h-5 sm:w-6 sm:h-6 object-contain flex-shrink-0"
                                  />
                                ) : <span className="text-gray-400 dark:text-gray-500 font-medium text-xs">-</span>}
                              </div>
                              <div className="mt-1 text-center leading-tight min-w-0">
                                <div className="text-[10px] font-medium text-gray-900 dark:text-white truncate">{fixtureSecondaryLines[0]}</div>
                                {fixtureSecondaryLines[1] ? (
                                  <div className="text-[9px] text-gray-500 dark:text-gray-400 truncate">{fixtureSecondaryLines[1]}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                        {nextFixtureMeta ? (
                          <div className={`text-center text-[10px] leading-tight ${nextFixtureMeta.isError ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-300'}`}>
                            {nextFixtureMeta.primary ? <div>{nextFixtureMeta.primary}</div> : null}
                            {nextFixtureMeta.secondary ? <div>{nextFixtureMeta.secondary}</div> : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="w-full min-w-0 border-t border-gray-200 dark:border-gray-700/80 pt-2 mt-1.5 lg:mt-2 lg:pt-2">
                      {propsMode === 'player' ? (
                        <div ref={playerSearchWrapRef} className="relative mx-auto max-w-xl lg:max-w-lg">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                            aria-hidden
                          />
                          <input
                            id="soccer-player-search"
                            type="search"
                            autoComplete="off"
                            value={playerSearchQuery}
                            onChange={(e) => {
                              setPlayerSearchQuery(e.target.value);
                              setPlayerSearchOpen(true);
                            }}
                            onFocus={() => setPlayerSearchOpen(true)}
                            placeholder="Search soccer players..."
                            className={`w-full rounded-lg border py-2 pl-9 pr-3 text-sm placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 dark:placeholder-gray-400 ${
                              mounted && isDark
                                ? 'border-gray-600 bg-[#0f172a] text-white'
                                : 'border-gray-300 bg-gray-50 text-gray-900'
                            }`}
                          />
                          {playerSearchOpen ? (
                            <div
                              className={`absolute left-0 right-0 top-full z-[80] mt-1 max-h-64 overflow-y-auto rounded-lg border shadow-lg custom-scrollbar ${
                                mounted && isDark ? 'border-gray-600 bg-[#0f172a]' : 'border-gray-200 bg-white'
                              }`}
                            >
                              {filteredSoccerPlayers.length === 0 ? (
                                <div className={`px-3 py-3 text-sm ${emptyText}`}>
                                  {globalCachedPlayersLoading
                                    ? 'Loading cached players…'
                                    : soccerPlayerUniverse.length === 0
                                      ? 'No cached players yet — run the player-stats batch, then search any player with stored games.'
                                      : 'No players match'}
                                </div>
                              ) : (
                                <ul className="py-1">
                                  {filteredSoccerPlayers.map((player) => (
                                    <li key={`${player.id}-${player.teamName}`}>
                                      <button
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                          setSelectedSoccerPlayer(player);
                                          setPlayerSearchQuery(player.name);
                                          setPlayerSearchOpen(false);
                                          if (player.teamHref) {
                                            const matchedTeam = teamUniverse.find((team) => normalizeTeamHref(team.href) === normalizeTeamHref(player.teamHref)) ?? null;
                                            if (matchedTeam) {
                                              setSelectedTeam(matchedTeam);
                                              setTeamSearchQuery(matchedTeam.name);
                                              updateTeamUrl(matchedTeam.href);
                                            }
                                          }
                                        }}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-[#1e293b] ${
                                          selectedSoccerPlayer?.id === player.id ? 'bg-purple-50 dark:bg-purple-950/40' : ''
                                        }`}
                                      >
                                        {player.imageUrl ? (
                                          <img src={player.imageUrl} alt={player.name} className="h-8 w-8 rounded-full object-cover" />
                                        ) : (
                                          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${mounted && isDark ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}>
                                            {player.name
                                              .split(/\s+/)
                                              .filter(Boolean)
                                              .map((w) => w[0])
                                              .join('')
                                              .slice(0, 2)
                                              .toUpperCase() || '?'}
                                          </span>
                                        )}
                                        <span className="min-w-0">
                                          <span className="block truncate font-medium text-gray-900 dark:text-white">{player.name}</span>
                                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                                            {player.teamName}
                                            {player.role ? ` · ${player.role}` : ''}
                                          </span>
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div ref={teamSearchWrapRef} className="relative mx-auto max-w-xl lg:max-w-lg">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                            aria-hidden
                          />
                          <input
                            id="soccer-team-search"
                            type="search"
                            autoComplete="off"
                            value={teamSearchQuery}
                            onChange={(e) => {
                              setTeamSearchQuery(e.target.value);
                              setTeamSearchOpen(true);
                            }}
                            onFocus={() => setTeamSearchOpen(true)}
                            placeholder={
                              teamUniverse.length
                                ? `Search ${teamUniverse.length} teams by name, league, or country...`
                                : 'Teams load with the sample - refresh if empty...'
                            }
                            className={`w-full rounded-lg border py-2 pl-9 pr-3 text-sm placeholder-gray-500 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 dark:placeholder-gray-400 ${
                              mounted && isDark
                                ? 'border-gray-600 bg-[#0f172a] text-white'
                                : 'border-gray-300 bg-gray-50 text-gray-900'
                            }`}
                          />
                          {teamSearchOpen && teamSearchQuery.trim() ? (
                            <div
                              className={`absolute left-0 right-0 top-full z-[80] mt-1 max-h-64 overflow-y-auto rounded-lg border shadow-lg custom-scrollbar ${
                                mounted && isDark ? 'border-gray-600 bg-[#0f172a]' : 'border-gray-200 bg-white'
                              }`}
                            >
                              {filteredTeams.length === 0 ? (
                                <div className={`px-3 py-3 text-sm ${emptyText}`}>No teams match</div>
                              ) : (
                                <ul className="py-1">
                                  {filteredTeams.map((team) => {
                                    const meta =
                                      team.competitions.length > 0
                                        ? team.competitions
                                            .map((c) => [c.country, c.competition].filter(Boolean).join(' · '))
                                            .join(' | ')
                                        : '';
                                    return (
                                      <li key={team.href}>
                                        <button
                                          type="button"
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={() => {
                                            setSelectedTeam(team);
                                            setTeamSearchQuery(team.name);
                                            setTeamSearchOpen(false);
                                            updateTeamUrl(team.href);
                                          }}
                                          className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-[#1e293b] ${
                                            selectedTeam?.href === team.href ? 'bg-purple-50 dark:bg-purple-950/40' : ''
                                          }`}
                                        >
                                          <span className="font-medium text-gray-900 dark:text-white">{team.name}</span>
                                          {meta ? <span className="text-xs text-gray-500 dark:text-gray-400">{meta}</span> : null}
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3. Chart container */}
                <div
                  className={`chart-container-no-focus relative z-10 rounded-lg p-0 h-[520px] sm:h-[460px] md:h-[510px] lg:h-[580px] w-full flex flex-col min-w-0 flex-shrink-0 overflow-hidden ${AFL_DASH_CARD_GLOW} sm:pt-0 sm:pr-1 sm:pb-0 sm:pl-0 md:pt-1 md:pr-2 md:pb-0 md:pl-0 lg:pt-2 lg:pr-3 lg:pb-0 lg:pl-0`}
                  style={{ outline: 'none' }}
                >
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    {propsMode === 'team' ? (
                      <div
                        className={`flex-shrink-0 border-b px-3 py-2.5 text-sm font-semibold ${
                          mounted && isDark ? 'border-gray-700 text-gray-100' : 'border-gray-200 text-gray-900'
                        }`}
                      >
                        Team stats chart{selectedTeam ? ` · ${selectedTeam.name}` : ''}
                      </div>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-hidden px-1 py-1 sm:px-2 sm:py-2">
                      {propsMode === 'player' ? (
                        <SoccerPlayerPropsTestCard
                          teamHref={selectedTeamHref || null}
                          playerKey={selectedSoccerPlayer?.id ?? chartBootstrapPlayer?.playerKey ?? null}
                          displayName={selectedSoccerPlayer?.name ?? chartBootstrapPlayer?.displayName ?? null}
                          nextOpponentName={displayOpponent}
                          isDark={Boolean(mounted && isDark)}
                          emptyTextClass={emptyText}
                          onChartSnapshotChange={handlePlayerPropsChartSnapshot}
                        />
                      ) : !selectedTeam ? (
                        <div className={`flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm ${emptyText}`}>
                          Select a team above to chart Soccerway match stats.
                        </div>
                      ) : mainChartLoading ? (
                        <div className="h-full w-full flex flex-col" style={{ padding: '16px 8px 8px 8px' }}>
                          <div className="flex-1 flex items-end justify-center gap-1 px-2 h-full">
                            {[...Array(20)].map((_, idx) => {
                              const heights = [45, 62, 38, 71, 55, 48, 65, 42, 58, 51, 47, 63, 39, 72, 56, 49, 66, 43, 59, 52];
                              const height = heights[idx] || 48;
                              return (
                                <div
                                  key={idx}
                                  className="flex-1 max-w-[50px] flex flex-col items-center justify-end"
                                  style={{ height: '100%' }}
                                >
                                  <div
                                    className={`w-full rounded-t animate-pulse ${mounted && isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
                                    style={{
                                      height: `${height}%`,
                                      animationDelay: `${idx * 0.08}s`,
                                      minHeight: '30px',
                                      transition: 'height 0.3s ease',
                                      minWidth: '28px',
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : recentMatchesError ? (
                        <div className="px-2 py-4 text-sm text-red-600 dark:text-red-400">{recentMatchesError}</div>
                      ) : displayedRecentMatches.length === 0 ? (
                        <div className={`px-2 py-6 text-center text-sm ${emptyText}`}>{recentMatchesEmptyMessage}</div>
                      ) : (
                        <SoccerStatsChart
                          matches={displayedRecentMatches}
                          selectedTeamName={selectedTeam.name}
                          nextOpponentName={displayOpponent}
                          selectedTeamHref={selectedTeamHref}
                          nextFixtureMatchId={nextFixture?.matchId ?? null}
                          oddsFormat={oddsFormat}
                          isDark={Boolean(mounted && isDark)}
                          onSelectedStatChange={setMainChartStat}
                          onSelectedTimeframeChange={setChartTimeframe}
                          onSelectedTeamScopeChange={setChartTeamScope}
                          onSelectedCompetitionChange={setChartCompetition}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {propsMode === 'player' && (
                  <div className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                    <h3 className={`text-sm font-semibold mb-1 px-3 sm:px-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      Supporting stats
                    </h3>
                    <div className="min-h-[220px] px-0 sm:px-0">
                      {!selectedSoccerPlayer && !chartBootstrapPlayer?.playerKey ? (
                        <div className={`min-h-[120px] flex items-center justify-center px-4 text-center text-sm ${emptyText}`}>
                          Select a player to load supporting stats.
                        </div>
                      ) : playerPropsChartSnapshot?.loading ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="space-y-3 w-full max-w-md">
                            <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`} />
                            <div className="grid grid-cols-2 gap-4">
                              <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                              <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                            </div>
                          </div>
                        </div>
                      ) : !playerPropsChartSnapshot?.matches.length ? (
                        <div className={`min-h-[120px] flex items-center justify-center px-4 text-center text-sm ${emptyText}`}>
                          No cached player stats yet. Run the batch scrape, then select the player again.
                        </div>
                      ) : (
                        <SoccerPlayerSupportingStats
                          matches={playerPropsChartSnapshot.matches}
                          mainStatKey={playerPropsChartSnapshot.mainStatKey}
                          timeframe={playerPropsChartSnapshot.timeframe}
                          competitionFilter={playerPropsChartSnapshot.competitionFilter}
                          nextOpponentName={displayOpponent}
                          isDark={Boolean(mounted && isDark)}
                        />
                      )}
                    </div>
                  </div>
                )}

                {propsMode === 'team' && (
                  <div className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                    <h3 className={`text-sm font-semibold mb-1 px-3 sm:px-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      Supporting stats
                    </h3>
                    <div className="min-h-[220px] px-0 sm:px-0">
                      {!selectedTeam ? (
                        <div className={`min-h-[120px] flex items-center justify-center px-4 text-center text-sm ${emptyText}`}>
                          Select a team above to load supporting stats.
                        </div>
                      ) : syncedStatsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="space-y-3 w-full max-w-md">
                            <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`} />
                            <div className="grid grid-cols-2 gap-4">
                              <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                              <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                            </div>
                          </div>
                        </div>
                      ) : recentMatchesError ? (
                        <div className="px-3 py-4 text-sm text-red-600 dark:text-red-400">{recentMatchesError}</div>
                      ) : displayedRecentMatches.length === 0 ? (
                        <div className={`px-3 py-4 text-center text-sm ${emptyText}`}>{recentMatchesEmptyMessage}</div>
                      ) : (
                        <SoccerSupportingStats
                          matches={displayedRecentMatches}
                          selectedTeamName={selectedTeam.name}
                          nextOpponentName={displayOpponent}
                          timeframe={chartTimeframe}
                          teamScope={chartTeamScope}
                          competitionFilter={chartCompetition}
                          mainChartStat={mainChartStat}
                          isDark={Boolean(mounted && isDark)}
                        />
                      )}
                    </div>
                  </div>
                )}

                <div className={`w-full min-w-0 flex flex-col rounded-lg ${AFL_DASH_CARD_GLOW} mt-0 py-3 sm:py-4 md:py-4 px-0 lg:px-3 xl:px-4`}>
                  {!selectedTeam ? (
                    <div className={`px-3 sm:px-4 text-sm ${emptyText}`}>Select a team above to load predicted lineups.</div>
                  ) : syncedLineupLoading ? (
                    <div className="px-3 sm:px-4">
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {[0, 1].map((idx) => (
                          <div key={idx} className={`rounded-xl border p-4 ${isDark ? 'border-white/10 bg-[#07131f]' : 'border-gray-200 bg-gray-50/80'}`}>
                            <div className={`mb-3 h-4 w-28 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
                            <div className={`h-[280px] rounded-2xl animate-pulse ${isDark ? 'bg-emerald-950/70' : 'bg-emerald-100'}`} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : predictedLineupError ? (
                    <div className="px-3 sm:px-4 text-sm text-red-600 dark:text-red-400">{predictedLineupError}</div>
                  ) : predictedLineupCacheMiss ? (
                    <div className={`px-3 sm:px-4 text-sm ${emptyText}`}>No data available come back later</div>
                  ) : (
                    <SoccerPredictedLineup
                      lineup={predictedLineup}
                      isDark={Boolean(mounted && isDark)}
                      lineupFrom={predictedLineupFrom}
                      onLineupPlayerClick={handleLineupPlayerClick}
                    />
                  )}
                </div>

                {/* 4.5 — mobile placeholder (right-column mirror, empty) */}
                <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  <div className="min-h-[200px]" />
                </div>

                {/* 4.6 Injuries — mobile */}
                {propsMode === 'player' && (
                  <div className={`lg:hidden rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 w-full min-w-0 flex flex-col max-h-[50vh] min-h-0`}>
                    <div className="flex-1 min-h-0 flex items-center justify-center">
                      <div className={`text-sm ${emptyText}`} />
                    </div>
                  </div>
                )}

                {/* 4.7 Ladder — mobile */}
                <div className={`lg:hidden w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4`}>
                  <div className="min-h-[200px]" />
                </div>

                {/* 5. Game log / box score area */}
                {propsMode === 'player' && (
                  <div className="w-full min-w-0 pb-6 lg:pb-0">
                    <div className={`min-h-[120px] rounded-lg border border-dashed ${isDark ? 'border-gray-700' : 'border-gray-200'}`} />
                  </div>
                )}
              </div>

              {/* Right panel — empty shells (layout only) */}
              <div
                className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar min-w-0 ${
                  sidebarOpen ? 'lg:flex-[2.6] xl:flex-[2.9]' : 'lg:flex-[3.2] xl:flex-[3.2]'
                }`}
              >
                <div className={`hidden lg:block w-full min-w-0 rounded-lg ${AFL_DASH_CARD_GLOW} p-3 sm:p-4 md:p-4`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
                  </div>
                  <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
                    <button
                      type="button"
                      onClick={() => setPropsMode('player')}
                      className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                        propsMode === 'player'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Player Props
                    </button>
                    <button
                      type="button"
                      onClick={() => setPropsMode('team')}
                      className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors border ${
                        propsMode === 'team'
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      Game Props
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                    {propsMode === 'player' ? 'Analyze individual player statistics and props' : 'Analyze game totals, spreads, and game-based props'}
                  </p>
                </div>
                <div className={`hidden lg:block h-[420px] w-full min-w-0 shrink-0 rounded-lg xl:h-[460px] ${AFL_DASH_CARD_GLOW} overflow-hidden`}>
                  <SoccerOpponentBreakdownMatchupPanel
                    isDark={Boolean(mounted && isDark)}
                    teamName={selectedTeam?.name ?? null}
                    teamHref={selectedTeam?.href ?? null}
                    opponentName={displayOpponent}
                    opponentHref={nextOpponentHrefForPanel}
                    nextCompetitionName={nextFixture?.competitionName ?? null}
                    nextCompetitionCountry={nextFixture?.competitionCountry ?? null}
                    statKey={mainChartStat}
                    playerPosition={propsMode === 'player' ? selectedSoccerPlayer?.role ?? null : null}
                    emptyTextClass={emptyText}
                    showSkeleton={fixtureGatedPanelSkeleton}
                  />
                </div>
                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${AFL_DASH_CARD_GLOW} overflow-hidden`}>
                  <SoccerTeamFormHomeAwayPanel
                    isDark={Boolean(mounted && isDark)}
                    teamName={selectedTeam?.name ?? null}
                    teamHref={selectedTeam?.href ?? null}
                    opponentName={displayOpponent}
                    opponentHref={nextOpponentHrefForPanel}
                    matches={displayedRecentMatches}
                    teamCompetitions={selectedTeam?.competitions ?? []}
                    nextCompetitionName={nextFixture?.competitionName ?? null}
                    nextCompetitionCountry={nextFixture?.competitionCountry ?? null}
                    emptyTextClass={emptyText}
                    showSkeleton={fixtureGatedPanelSkeleton}
                    comparisonShowSkeleton={propsMode === 'team' && syncedStatsLoading}
                  />
                </div>
                <div className={`hidden lg:block w-full min-w-0 shrink-0 rounded-lg ${AFL_DASH_CARD_GLOW} overflow-hidden`}>
                  <SoccerInjuriesCard
                    isDark={Boolean(mounted && isDark)}
                    teamName={selectedTeam?.name ?? null}
                    teamHref={selectedTeam?.href ?? null}
                    opponentName={displayOpponent}
                    opponentHref={nextOpponentHrefForPanel}
                    emptyTextClass={emptyText}
                    showSkeleton={fixtureGatedPanelSkeleton}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MobileBottomNavigation
        hasPremium={isPro}
        username={username}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        showJournalDropdown={showJournalDropdown}
        showProfileDropdown={showProfileDropdown}
        showSettingsDropdown={showSettingsDropdown}
        setShowJournalDropdown={setShowJournalDropdown}
        setShowProfileDropdown={setShowProfileDropdown}
        setShowSettingsDropdown={setShowSettingsDropdown}
        profileDropdownRef={profileDropdownRef}
        journalDropdownRef={journalDropdownRef}
        settingsDropdownRef={settingsDropdownRef}
        onProfileClick={() => window.dispatchEvent(new CustomEvent('open-profile-modal'))}
        onSubscription={() => router.push('/subscription')}
        onLogout={async () => {
          await supabase.auth.signOut({ scope: 'local' });
          router.push('/');
        }}
        theme={theme}
        oddsFormat={oddsFormat}
        setTheme={setTheme}
        setOddsFormat={(fmt) => {
          setOddsFormat(fmt);
          try {
            localStorage.setItem('oddsFormat', fmt);
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
}

export default function SoccerPage() {
  return (
    <Suspense fallback={null}>
      <SoccerPageContent />
    </Suspense>
  );
}
