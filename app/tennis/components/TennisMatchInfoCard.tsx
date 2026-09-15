'use client';

import { Plane } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import {
  isUnplayedTennisMatch,
  tennisEventPlaceLabel,
  tennisLastName,
  tennisRoundLabel,
  tennisScoreGameTotals,
} from '@/lib/tennis/chartStats';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import type { TennisDvpStage } from '@/lib/tennis/dvpShared';
import { TennisTournamentRankInfoButton } from '@/app/tennis/components/TennisTournamentRankInfoButton';
import {
  calendarDaysBetween,
  courtPaceBand,
  daysSinceTimestamp,
  formatTimezoneDiff,
  lookupCourtPace,
  lookupTennisVenue,
  parseTennisLogDate,
  sameTennisEvent,
} from '@/lib/tennis/venues';

function surfaceLine(setting: string | null | undefined, surface: string | null | undefined): string {
  const raw = String(surface || '').toLowerCase();
  const court = raw.includes('clay')
    ? 'clay'
    : raw.includes('grass')
      ? 'grass'
      : raw.includes('hard') || raw.includes('carpet') || raw.includes('acrylic')
        ? 'hard'
        : '';
  const where = setting === 'Indoor' || setting === 'Outdoor' ? setting : '';
  if (where && court) return `${where} ${court}`;
  if (court) return court.charAt(0).toUpperCase() + court.slice(1);
  if (where) return where;
  return '—';
}

function rankLabel(rank: number | null | undefined): string {
  return rank && rank > 0 ? `#${rank}` : '—';
}

function setsInRow(row: Record<string, unknown>): number {
  if (isUnplayedTennisMatch(row.score)) return 0;
  const total = Number(row.totalSets);
  if (Number.isFinite(total) && total > 0) return total;
  const won = Number(row.setsWon);
  const lost = Number(row.setsLost);
  if (Number.isFinite(won) && Number.isFinite(lost) && won + lost > 0) return won + lost;
  return 0;
}

function gamesInRow(row: Record<string, unknown>): number {
  if (isUnplayedTennisMatch(row.score)) return 0;
  const total = Number(row.totalGames);
  if (Number.isFinite(total) && total > 0) return total;
  const won = Number(row.gamesWon);
  const lost = Number(row.gamesLost);
  if (Number.isFinite(won) && Number.isFinite(lost) && won + lost > 0) return won + lost;
  const fromScore = tennisScoreGameTotals(row.score);
  if (fromScore) return fromScore.gamesWon + fromScore.gamesLost;
  return 0;
}

function Row({
  label,
  muted,
  valueClass,
  info,
  children,
}: {
  label: string;
  muted: string;
  valueClass?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-w-0 items-baseline justify-between gap-3">
      <span className={`flex shrink-0 items-center gap-1 text-[12px] ${muted}`}>
        {label}
        {info}
      </span>
      <span className={`min-w-0 truncate text-right text-[13px] font-semibold leading-tight ${valueClass || ''}`}>
        {children}
      </span>
    </div>
  );
}

function Flag({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-4 w-[22px] flex-shrink-0 rounded-sm object-cover ring-1 ring-black/15"
    />
  );
}

export default function TennisMatchInfoCard({
  isDark = false,
  playerName = null,
  playerIoc = null,
  playerRank = null,
  playerSeed = null,
  opponentName = null,
  opponentIoc = null,
  opponentRank = null,
  opponentSeed = null,
  tournamentName = null,
  round = null,
  surface = null,
  tipoff = null,
  gameLogs = [],
}: {
  isDark?: boolean;
  playerName?: string | null;
  playerIoc?: string | null;
  playerRank?: number | null;
  playerSeed?: number | null;
  opponentName?: string | null;
  opponentId?: string | null;
  opponentIoc?: string | null;
  opponentRank?: number | null;
  opponentSeed?: number | null;
  tournamentName?: string | null;
  round?: string | null;
  surface?: string | null;
  tour?: 'ATP' | 'WTA' | null;
  isGrandSlam?: boolean;
  stage?: TennisDvpStage;
  tipoff?: Date | null;
  live?: boolean;
  isGameInProgress?: boolean;
  countdown?: { hours: number; minutes: number; seconds: number } | null;
  topSeedName?: string | null;
  gameLogs?: Array<Record<string, unknown>>;
}) {
  const player = String(playerName || '').trim();
  const opponent = String(opponentName || '').trim();
  const place = tennisEventPlaceLabel(tournamentName);
  const roundLabel = tennisRoundLabel(round);
  const playerFlag = tennisFlagUrl(playerIoc);
  const oppFlag = tennisFlagUrl(opponentIoc);
  const asOfKey = tipoff && !Number.isNaN(tipoff.getTime()) ? tipoff.toISOString() : 'now';

  const context = useMemo(() => {
    const asOf = asOfKey === 'now' ? new Date() : new Date(asOfKey);
    const here = lookupTennisVenue(tournamentName || place, surface);
    const logs = [...(gameLogs || [])].filter((row) => parseTennisLogDate(String(row.date || '')));
    logs.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    const thisEventLogs = logs.filter((row) => {
      if (!sameTennisEvent(String(row.tourneyName || ''), tournamentName || place)) return false;
      const played = parseTennisLogDate(String(row.date || row.tourneyDate || ''));
      if (!played) return false;
      const daysAgo = calendarDaysBetween(played, asOf);
      return daysAgo >= -1 && daysAgo <= 21;
    });
    const setsHere = thisEventLogs.reduce((sum, row) => sum + setsInRow(row), 0);
    const gamesHere = thisEventLogs.reduce((sum, row) => sum + gamesInRow(row), 0);

    let lastAway: Record<string, unknown> | null = null;
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const row = logs[i];
      if (!sameTennisEvent(String(row.tourneyName || ''), tournamentName || place)) {
        lastAway = row;
        break;
      }
    }
    const lastEventDate = lastAway ? parseTennisLogDate(String(lastAway.date || '')) : null;
    const lastEventDays = lastEventDate ? daysSinceTimestamp(lastEventDate, asOf) : null;
    const lastVenue = lastAway
      ? lookupTennisVenue(String(lastAway.tourneyName || ''), String(lastAway.surface || ''))
      : null;
    const tzDiff = formatTimezoneDiff(lastVenue, here, asOf);
    const pace = lookupCourtPace(tournamentName || place);

    return {
      here,
      setsHere,
      gamesHere,
      lastEventDays,
      lastVenue,
      tzDiff,
      pace,
    };
  }, [asOfKey, gameLogs, place, surface, tournamentName]);

  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const title = isDark ? 'text-white' : 'text-gray-900';
  const panel = isDark ? 'bg-white/[0.035]' : 'bg-gray-50';
  const { here } = context;
  const pace = context.pace;
  const speedColor =
    pace == null
      ? title
      : pace < 30
        ? isDark
          ? 'text-sky-300'
          : 'text-sky-700'
        : pace >= 44
          ? isDark
            ? 'text-orange-300'
            : 'text-orange-600'
          : isDark
            ? 'text-amber-300'
            : 'text-amber-700';
  const sinceColor =
    context.lastEventDays == null
      ? title
      : context.lastEventDays <= 1
        ? isDark
          ? 'text-orange-300'
          : 'text-orange-600'
        : context.lastEventDays >= 5
          ? isDark
            ? 'text-emerald-300'
            : 'text-emerald-700'
          : title;
  const loadColor =
    context.setsHere >= 8 || context.gamesHere >= 50
      ? isDark
        ? 'text-orange-300'
        : 'text-orange-600'
      : title;
  const fromCity = context.lastVenue?.city || '';
  const toCity = here.city || place || '';
  const sameStop = Boolean(fromCity && toCity && fromCity === toCity);
  const leftSeed = playerSeed && playerSeed > 0 ? playerSeed : null;
  const rightSeed = opponentSeed && opponentSeed > 0 ? opponentSeed : null;
  const seedDiffLabel =
    leftSeed != null && rightSeed != null ? `${leftSeed} vs ${rightSeed}` : '—';
  const paceLabel = pace == null ? '—' : pace.toFixed(pace % 1 === 0 ? 0 : 1);
  const paceBand = pace != null ? courtPaceBand(pace) : '';
  const daysLabel =
    context.lastEventDays == null
      ? '—'
      : context.lastEventDays === 0
        ? '0 days'
        : context.lastEventDays === 1
          ? '1 day'
          : `${context.lastEventDays} days`;
  const eventMeta = [place, roundLabel].filter(Boolean).join(' · ');

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden px-1.5 py-1">
      <div className="mb-2 flex flex-shrink-0 items-baseline justify-between gap-2">
        <h3 className={`text-sm font-semibold ${title}`}>Match Info</h3>
        {eventMeta ? <span className={`min-w-0 truncate text-[11px] ${muted}`}>{eventMeta}</span> : null}
      </div>
      {!player ? (
        <div className={`flex flex-1 items-center justify-center text-sm ${muted}`}>Select a player to see match info.</div>
      ) : !opponent ? (
        <div className={`flex flex-1 items-center justify-center text-sm ${muted}`}>No upcoming match.</div>
      ) : (
        <>
          <div className={`mb-3 grid flex-shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg px-2.5 py-2.5 ${panel}`}>
            <div className="flex min-w-0 items-center justify-end gap-2">
              <Flag src={playerFlag} />
              <div className="min-w-0 text-right">
                <div className={`truncate text-sm font-bold leading-tight ${title}`}>{tennisLastName(player)}</div>
                <div className={`text-[10px] tabular-nums ${muted}`}>{rankLabel(playerRank)}</div>
              </div>
            </div>
            <div className="px-1.5 text-center">
              <div className={`text-[15px] font-semibold tabular-nums leading-none ${title}`}>{seedDiffLabel}</div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <div className={`truncate text-sm font-bold leading-tight ${title}`}>{tennisLastName(opponent)}</div>
                <div className={`text-[10px] tabular-nums ${muted}`}>{rankLabel(opponentRank)}</div>
              </div>
              <Flag src={oppFlag} />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5 custom-scrollbar">
            <div className="flex flex-col gap-3 px-0.5 pb-1 pt-0.5">
              <Row label="Surface" muted={muted} valueClass={title}>
                {surfaceLine(here.setting, surface)}
              </Row>
              <Row
                label="Court pace"
                muted={muted}
                valueClass={speedColor}
                info={
                  <TennisTournamentRankInfoButton
                    isDark={isDark}
                    label="How court pace is set"
                    title="Court Pace Index"
                    text={
                      'This is the Court Pace Index from centre-court readings, not a guess from indoor/outdoor or surface type.\nUnder 30 is slow, 35–39 is medium, over 44 is fast.\nIf this event has no CPI reading, we show a dash.'
                    }
                  />
                }
              >
                {paceLabel}
                {paceBand ? <span className={`ml-1.5 text-[11px] font-medium ${muted}`}>{paceBand}</span> : null}
              </Row>
              <Row label="Travel" muted={muted} valueClass={title}>
                {fromCity && toCity ? (
                  <span className="inline-flex max-w-full items-center justify-end gap-1.5">
                    <span className="truncate">{fromCity}</span>
                    {sameStop ? (
                      <span className={`shrink-0 text-[11px] font-medium ${muted}`}>already here</span>
                    ) : (
                      <>
                        <Plane className={`h-3.5 w-3.5 shrink-0 ${muted}`} aria-hidden />
                        <span className="truncate">{toCity}</span>
                      </>
                    )}
                  </span>
                ) : (
                  <span className={muted}>No prior event in logs</span>
                )}
              </Row>
              <Row label="Timezone" muted={muted} valueClass={title}>
                {context.tzDiff || '—'}
              </Row>
              <Row label="Last event" muted={muted} valueClass={sinceColor}>
                {daysLabel}
              </Row>
              <Row label="This tournament" muted={muted} valueClass={loadColor}>
                {context.setsHere} sets · {context.gamesHere} games
              </Row>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
