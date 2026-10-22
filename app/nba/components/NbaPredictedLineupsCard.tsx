'use client';

import { useEffect, useState } from 'react';
import type { NbaPredictedLineupsPayload, NbaPredictedPlayer } from '@/lib/nba/dash/predictedLineupsShared';
import { resolveNbaClub } from '@/lib/nba/dash/teams';

type LastGamePlayer = { playerId: string | null; name: string; position?: string | null; imageUrl?: string | null };
type LastGameTeam = { team: string; lineup: { starters: LastGamePlayer[] }; match?: { tipoff?: string | null } | null };
type InjuryRow = { team: string; player: string; playerId: string; injury: string; returning: string | null };

/** `note` is extra tooltip text, e.g. the estimated return date from the injury report. */
type CardPlayer = NbaPredictedPlayer & { note?: string | null };

type CardTeam = {
  key: string;
  name: string;
  side: 'Away' | 'Home' | null;
  confirmed: boolean;
  playedAt: string | null;
  starters: CardPlayer[];
  mayNotPlay: CardPlayer[];
};

type CardData =
  | { kind: 'predicted'; checkedAt: string | null; teams: CardTeam[] }
  | { kind: 'lastGame'; teams: CardTeam[] };

const CACHE_TTL_MS = 2 * 60 * 1000;
const cardCache = new Map<string, { data: CardData | null; at: number }>();

function getJson(url: string): Promise<unknown> {
  return fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

function lastGameTeam(raw: unknown, injuries: InjuryRow[]): CardTeam | null {
  const own = ((raw as { team?: LastGameTeam } | null)?.team ?? null) as LastGameTeam | null;
  if (!own?.lineup?.starters?.length) return null;
  const teamInjuries = injuries.filter((i) => sameTeam(i.team, own.team));
  const injuryFor = (id: string | null, name: string) =>
    teamInjuries.find((i) => (id && i.playerId === id) || normName(i.player) === normName(name)) ?? null;
  const starters: CardPlayer[] = own.lineup.starters.slice(0, 5).map((s) => {
    const inj = injuryFor(s.playerId, s.name);
    return {
      name: s.name,
      position: s.position || '',
      playerId: s.playerId,
      imageUrl: s.imageUrl ?? null,
      status: inj?.injury || null,
      playPct: null,
      note: inj?.returning ?? null,
    };
  });
  const mayNotPlay: CardPlayer[] = teamInjuries
    .filter((i) => !starters.some((s) => (s.playerId && s.playerId === i.playerId) || normName(s.name) === normName(i.player)))
    .map((i) => ({
      name: i.player,
      position: '',
      playerId: i.playerId,
      imageUrl: null,
      status: i.injury || null,
      playPct: null,
      note: i.returning,
    }));
  return {
    key: resolveNbaClub(own.team)?.code ?? own.team,
    name: own.team,
    side: null,
    confirmed: true,
    playedAt: own.match?.tipoff ?? null,
    starters,
    mayNotPlay,
  };
}

async function loadCard(team: string, opponent: string | null): Promise<CardData | null> {
  const predicted = (await getJson(`/api/nba/dash/predicted-lineups?${new URLSearchParams({ team })}`)) as {
    lineups?: NbaPredictedLineupsPayload | null;
  } | null;
  const p = predicted?.lineups ?? null;
  if (p) {
    return {
      kind: 'predicted',
      checkedAt: p.checkedAt,
      teams: [
        { t: p.away, side: 'Away' as const },
        { t: p.home, side: 'Home' as const },
      ].map(({ t, side }) => ({
        key: t.code,
        name: t.name,
        side,
        confirmed: t.confirmed,
        playedAt: null,
        starters: t.starters,
        mayNotPlay: t.mayNotPlay.filter((m) => !t.starters.some((s) => s.name === m.name)),
      })),
    };
  }
  const names = [team, ...(opponent && !sameTeam(team, opponent) ? [opponent] : [])];
  const [injuryPayload, ...lineups] = await Promise.all([
    getJson('/api/nba/dash/injuries'),
    ...names.map((n) => getJson(`/api/nba/dash/lineups?${new URLSearchParams({ team: n })}`)),
  ]);
  const injuries = ((injuryPayload as { injuries?: InjuryRow[] } | null)?.injuries ?? []) as InjuryRow[];
  const teams = lineups.map((raw) => lastGameTeam(raw, injuries)).filter((t): t is CardTeam => !!t);
  return teams.length ? { kind: 'lastGame', teams } : null;
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameTeam(a: string, b: string | null | undefined): boolean {
  if (!b) return false;
  const ca = resolveNbaClub(a)?.code;
  return !!ca && ca === resolveNbaClub(b)?.code;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

function agoText(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(mins)) return null;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

function dateText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

const SHORT_STATUS: Record<string, string> = {
  out: 'OUT',
  'out for season': 'OUT',
  doubtful: 'DOUBT',
  questionable: 'QUES',
  'game-time decision': 'GTD',
  probable: 'PROB',
  suspended: 'SUSP',
  'day-to-day': 'D2D',
};

function shortStatus(status: string | null): string {
  const s = String(status || '').toLowerCase();
  return SHORT_STATUS[s] ?? (status ? status.toUpperCase() : 'TBD');
}

function statusTitle(player: CardPlayer): string {
  return [
    player.status ?? 'Status unknown',
    player.playPct != null && player.playPct < 100 ? `${player.playPct}% chance to play` : null,
    player.note,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Pill colours by how likely the player is to sit. */
function statusTone(status: string | null): string {
  const s = String(status || '').toLowerCase();
  if (s.startsWith('out') || s === 'suspended') {
    return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30';
  }
  if (s === 'doubtful') return 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30';
  if (s === 'probable') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30';
  return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30';
}

function StatusPill({ player }: { player: CardPlayer }) {
  return <PlainPill text={shortStatus(player.status)} title={statusTitle(player)} tone={statusTone(player.status)} />;
}

function PlainPill({ text, title, tone }: { text: string; title: string; tone: string }) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 min-w-[2.5rem] shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-bold tracking-wide ring-1 ring-inset ${tone}`}
    >
      {text}
    </span>
  );
}

function StarterStatus({ player }: { player: CardPlayer }) {
  if (player.status) return <StatusPill player={player} />;
  return (
    <PlainPill
      text="ACTIVE"
      title="No injury designation"
      tone="bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30"
    />
  );
}

function Headshot({ player, highlight }: { player: NbaPredictedPlayer; highlight: boolean }) {
  const [broken, setBroken] = useState(false);
  const ring = highlight ? 'ring-2 ring-purple-500' : 'ring-1 ring-gray-200 dark:ring-white/10';
  if (player.imageUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.imageUrl}
        alt=""
        onError={() => setBroken(true)}
        className={`h-8 w-8 shrink-0 rounded-full bg-gray-100 object-cover object-top dark:bg-white/[0.06] ${ring}`}
      />
    );
  }
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-white/[0.06] dark:text-gray-300 ${ring}`}
    >
      {initials(player.name)}
    </span>
  );
}

function StateLabel({ kind, confirmed }: { kind: CardData['kind']; confirmed: boolean }) {
  const [dot, text] =
    kind === 'lastGame'
      ? ['bg-gray-400', 'Last game']
      : confirmed
        ? ['bg-emerald-500', 'Confirmed']
        : ['bg-amber-500', 'Projected'];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function TeamPanel({
  team,
  kind,
  selected,
  logo,
}: {
  team: CardTeam;
  kind: CardData['kind'];
  selected: string;
  logo: string | null;
}) {
  const subtitle =
    kind === 'lastGame' ? (dateText(team.playedAt) ? `Starters on ${dateText(team.playedAt)}` : 'Last game starters') : team.side;
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-700/60 dark:bg-white/[0.02]">
      <div className="flex items-center gap-2.5 border-b border-gray-200/80 bg-gray-50/80 px-3 py-2.5 dark:border-gray-700/60 dark:bg-white/[0.03]">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-7 w-7 shrink-0 object-contain" />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 dark:bg-white/10 dark:text-gray-300">
            {team.key.slice(0, 3)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight text-gray-900 dark:text-white" title={team.name}>
            {team.name}
          </div>
          {subtitle ? <div className="text-[11px] leading-tight text-gray-500 dark:text-gray-400">{subtitle}</div> : null}
        </div>
        <StateLabel kind={kind} confirmed={team.confirmed} />
      </div>

      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-x-2 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        <span>Pos</span>
        <span>Starting 5</span>
        <span className="text-right">Status</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
        {team.starters.map((p) => {
          const highlight = !!selected && normName(p.name) === selected;
          return (
            <div
              key={`${team.key}-${p.position}-${p.name}`}
              className={`relative grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1.5 ${
                highlight ? 'bg-purple-50/80 dark:bg-purple-500/[0.1]' : ''
              }`}
            >
              {highlight ? <span className="absolute inset-y-0 left-0 w-0.5 bg-purple-500" /> : null}
              <span className="text-[11px] font-bold tabular-nums text-gray-500 dark:text-gray-400">{p.position || '—'}</span>
              <div className="flex min-w-0 items-center gap-2.5">
                <Headshot player={p} highlight={highlight} />
                <span
                  className={`truncate text-[13px] font-semibold ${
                    highlight ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'
                  }`}
                  title={p.name}
                >
                  {p.name}
                </span>
              </div>
              <div className="flex justify-end">
                <StarterStatus player={p} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-200/80 px-3 pb-2.5 pt-2 dark:border-gray-700/60">
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          <span>May not play</span>
          {team.mayNotPlay.length ? <span className="tabular-nums">{team.mayNotPlay.length}</span> : null}
        </div>
        {team.mayNotPlay.length ? (
          <div className="space-y-1">
            {team.mayNotPlay.map((p) => {
              const highlight = !!selected && normName(p.name) === selected;
              return (
                <div key={`${team.key}-mnp-${p.name}`} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-[10px] font-bold text-gray-400 dark:text-gray-500">{p.position}</span>
                  <span
                    className={`min-w-0 flex-1 truncate text-xs font-medium ${
                      highlight ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300'
                    }`}
                    title={p.name}
                  >
                    {p.name}
                  </span>
                  <StatusPill player={p} />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">No injuries listed</p>
        )}
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200/80 dark:border-gray-700/60">
      <div className="h-12 animate-pulse bg-gray-100 dark:bg-white/[0.04]" />
      <div className="space-y-2 p-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-gray-100 dark:bg-white/[0.04]" style={{ animationDelay: `${i * 0.08}s` }} />
        ))}
      </div>
    </div>
  );
}

export function NbaPredictedLineupsCard({
  playerTeam,
  opponentTeam,
  selectedPlayerName,
  resolveTeamLogo,
}: {
  isDark?: boolean;
  playerTeam?: string | null;
  opponentTeam?: string | null;
  selectedPlayerName?: string | null;
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(false);
  const team = playerTeam?.trim() || '';
  const opponent = opponentTeam?.trim() || '';

  useEffect(() => {
    if (!team) {
      setData(null);
      setLoading(false);
      return;
    }
    const cacheKey = `${team.toLowerCase()}|${opponent.toLowerCase()}`;
    const cached = cardCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadCard(team, opponent || null)
      .then((next) => {
        cardCache.set(cacheKey, { data: next, at: Date.now() });
        if (!cancelled) setData(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [team, opponent]);

  const selected = normName(selectedPlayerName);
  const updated = data?.kind === 'predicted' ? agoText(data.checkedAt) : null;

  return (
    <div className="w-full min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold leading-tight text-gray-900 dark:text-white sm:text-base">Predicted lineups</h3>
        {updated ? <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">Updated {updated}</span> : null}
      </div>

      {!team ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Select a player or team to see the predicted starting fives.</p>
      ) : loading && !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      ) : !data ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No lineup available yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.teams.map((t) => (
            <TeamPanel key={t.key} team={t} kind={data.kind} selected={selected} logo={resolveTeamLogo?.(t.name) ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}
