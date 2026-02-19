'use client';

import { useMemo, useState } from 'react';

export type LineupPlayerForOval = {
  number: number | null;
  name: string;
  subbedOn?: boolean;
  subbedOff?: boolean;
  role?: 'starter' | 'interchange';
  /** Short position label from AFL official API (e.g. "MF", "KD"). When set, shown on oval instead of placeholder. */
  position?: string;
};

/** Format "Surname, First" or "Surname First" as "First Surname". */
function formatNameFirstLast(name: string): string {
  const s = (name || '').trim();
  if (!s) return s;
  const comma = s.indexOf(',');
  if (comma > 0) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    return first && last ? `${first} ${last}` : s;
  }
  return s;
}

/** Compact display: "First L." for side panels when long. */
function compactName(name: string, maxChars = 14): string {
  const n = formatNameFirstLast(name);
  if (n.length <= maxChars) return n;
  const parts = n.split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts[0];
    return `${first} ${last.charAt(0)}.`;
  }
  return n.slice(0, maxChars - 1) + '…';
}

/** AFL website style: 5 rows of 3 per team. Row labels (back → forward). */
const ROW_LABELS = ['Back', 'Half-back', 'Centre', 'Half-fwd', 'Forward'] as const;
const ROW_POSITIONS: [string, string, string][] = [
  ['FB', 'CHB', 'HB'],
  ['HB', 'CHB', 'HB'],
  ['R', 'C', 'W'],
  ['HF', 'CHF', 'HF'],
  ['FF', 'CHF', 'HF'],
];

/** Map API position to row index 0–4 (back, hb, mid, hf, fwd). */
function positionToRow5(pos: string | undefined): number {
  if (!pos) return 2;
  const p = pos.toUpperCase();
  if (['KD', 'MD', 'KEY_DEFENDER', 'MEDIUM_DEFENDER'].some((x) => p.includes(x))) return 0;
  if (['KF', 'MF', 'KEY_FORWARD', 'MEDIUM_FORWARD'].some((x) => p.includes(x))) return 4;
  return 2; // mid default
}

/** Place 15 starters into 5 rows of 3; defenders → rows 0–1, mids → 2, forwards → 3–4. */
function placeFieldPlayers5(starters: LineupPlayerForOval[]): LineupPlayerForOval[][] {
  const fifteen = starters.slice(0, 15);
  const back: LineupPlayerForOval[] = [];
  const mid: LineupPlayerForOval[] = [];
  const fwd: LineupPlayerForOval[] = [];
  for (const p of fifteen) {
    const r = positionToRow5(p.position);
    if (r <= 1) back.push(p);
    else if (r >= 3) fwd.push(p);
    else mid.push(p);
  }
  const overflow: LineupPlayerForOval[] = [];
  if (back.length > 6) overflow.push(...back.splice(6));
  if (mid.length > 3) overflow.push(...mid.splice(3));
  if (fwd.length > 6) overflow.push(...fwd.splice(6));
  const row0 = back.slice(0, 3);
  const row1 = back.slice(3, 6);
  const row2 = mid.slice(0, 3);
  const row3 = fwd.slice(0, 3);
  const row4 = fwd.slice(3, 6);
  let u = 0;
  const fill = (row: LineupPlayerForOval[]) => {
    while (row.length < 3 && u < overflow.length) row.push(overflow[u++]);
    return row.slice(0, 3);
  };
  return [fill(row0), fill(row1), fill(row2), fill(row3), fill(row4)];
}

const DEFAULT_TEAM1_COLOR = '#0a2540';
const DEFAULT_TEAM2_COLOR = '#c8102e';

function getTeamColor(teamLabel: string, index: 0 | 1): string {
  const key = teamLabel.toLowerCase().replace(/\s+/g, '');
  const colors: Record<string, [string, string]> = {
    geelong: ['#0a2540', '#fff'], // navy
    geelongcats: ['#0a2540', '#fff'],
    brisbane: ['#a30046', '#fff'], // maroon
    brisbanelions: ['#a30046', '#fff'],
    carlton: ['#011a31', '#fff'],
    carltonblues: ['#011a31', '#fff'],
    collingwood: ['#000', '#fff'],
    collingwoodmagpies: ['#000', '#fff'],
    essendon: ['#cc0000', '#000'],
    fremantle: ['#2a1a5e', '#fff'],
    goldcoast: ['#d4002b', '#fff'],
    gws: ['#f15a29', '#fff'],
    hawthorn: ['#4d2004', '#ffd700'],
    melbourne: ['#0a1136', '#fff'],
    northmelbourne: ['#013b9f', '#fff'],
    portadelaide: ['#00843d', '#fff'],
    richmond: ['#ffd700', '#000'],
    stkilda: ['#000', '#fff'],
    sydney: ['#e41720', '#fff'],
    westcoast: ['#062ee2', '#fff'],
    westerndogs: ['#014896', '#fff'],
  };
  const pair = colors[key];
  return pair ? pair[index] : index === 0 ? DEFAULT_TEAM1_COLOR : DEFAULT_TEAM2_COLOR;
}

type FilterMode = 'all' | 'team1' | 'team2';

export function AflLineupOval({
  team1Label,
  team2Label,
  team1Players,
  team2Players,
  isDark,
}: {
  team1Label: string;
  team2Label: string;
  team1Players: LineupPlayerForOval[];
  team2Players: LineupPlayerForOval[];
  isDark: boolean;
}) {
  const [filter, setFilter] = useState<FilterMode>('all');

  const team1Starters = useMemo(
    () => team1Players.filter((p) => p.role !== 'interchange').slice(0, 18),
    [team1Players]
  );
  const team2Starters = useMemo(
    () => team2Players.filter((p) => p.role !== 'interchange').slice(0, 18),
    [team2Players]
  );
  const team1Interchange = useMemo(
    () => team1Players.filter((p) => p.role === 'interchange'),
    [team1Players]
  );
  const team2Interchange = useMemo(
    () => team2Players.filter((p) => p.role === 'interchange'),
    [team2Players]
  );
  const team1Subs = useMemo(() => team1Players.filter((p) => p.subbedOn), [team1Players]);
  const team2Subs = useMemo(() => team2Players.filter((p) => p.subbedOn), [team2Players]);

  const color1 = getTeamColor(team1Label, 0);
  const color2 = getTeamColor(team2Label, 1);

  // 5 rows of 3 per team (AFL website style).
  const placedTeam1 = useMemo(() => placeFieldPlayers5(team1Starters), [team1Starters]);
  const placedTeam2 = useMemo(() => placeFieldPlayers5(team2Starters), [team2Starters]);

  const followersTeam1 = placedTeam1[2] ?? [];
  const followersTeam2 = placedTeam2[2] ?? [];

  const showTeam1 = filter === 'all' || filter === 'team1';
  const showTeam2 = filter === 'all' || filter === 'team2';

  const allSubs = [...(showTeam1 ? team1Subs : []), ...(showTeam2 ? team2Subs : [])];
  const allFollowers = [
    ...(showTeam1 ? followersTeam1 : []).map((p) => ({ ...p, _team: 1 as const })),
    ...(showTeam2 ? followersTeam2 : []).map((p) => ({ ...p, _team: 2 as const })),
  ];

  return (
    <div className={`rounded-lg p-3 ${isDark ? 'bg-[#0d1520]' : 'bg-gray-100'}`}>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-3">
        {(['all', 'team1', 'team2'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setFilter(mode)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === mode
                ? mode === 'all'
                  ? 'bg-gray-600 text-white'
                  : mode === 'team1'
                    ? 'text-white'
                    : 'text-white'
                : isDark
                  ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
            style={
              filter === mode
                ? { backgroundColor: mode === 'team1' ? color1 : mode === 'team2' ? color2 : isDark ? '#4b5563' : '#9ca3af' }
                : undefined
            }
          >
            {mode === 'all' ? 'All' : mode === 'team1' ? team1Label.split(/\s+/)[0] ?? team1Label : team2Label.split(/\s+/)[0] ?? team2Label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color1 }} />
          <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{team1Label}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color2 }} />
          <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{team2Label}</span>
        </span>
      </div>

      <div className="flex gap-2 items-stretch min-h-[420px]">
        {/* Followers (left) */}
        <div
          className={`w-24 shrink-0 rounded-lg p-2 flex flex-col ${isDark ? 'bg-[#1e293b]' : 'bg-white'} border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
        >
          <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
            Followers
          </p>
          <div className="flex flex-col gap-1">
            {allFollowers.map((p, i) => (
              <div
                key={`f-${i}`}
                className={`rounded px-1.5 py-1 text-[10px] border-l-2 ${isDark ? 'bg-[#0a1929]' : 'bg-gray-50'}`}
                style={{ borderLeftColor: p._team === 1 ? color1 : color2 }}
              >
                <span className="font-semibold" style={{ color: p._team === 1 ? color1 : color2 }}>
                  {p.number ?? '—'}
                </span>
                <span className={`block truncate text-[10px] ${isDark ? 'text-gray-300' : 'text-gray-800'}`} title={formatNameFirstLast(p.name)}>{compactName(p.name, 12)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AFL website style: 5 rows of 3 per team, one team on top / one below */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-[380px] overflow-auto">
          <div
            className="rounded-lg border-2 overflow-hidden flex-shrink-0"
            style={{
              background: 'linear-gradient(180deg, #1a472a 0%, #2d5a3d 100%)',
              borderColor: isDark ? '#334155' : '#4ade80',
            }}
          >
            {/* Team 1 – 5 rows of 3 */}
            <div className="p-2">
              <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} style={{ color: color1 }}>
                {team1Label}
              </p>
              {placedTeam1.map((rowPlayers, rowIndex) => (
                <div key={`t1-r${rowIndex}`} className="mb-1.5 last:mb-0">
                  <span className={`text-[9px] uppercase ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{ROW_LABELS[rowIndex]}</span>
                  <div className="grid grid-cols-3 gap-1 mt-0.5">
                  {(ROW_POSITIONS[rowIndex] ?? ['—', '—', '—']).map((pos, colIndex) => {
                    const p = rowPlayers[colIndex];
                    const show = showTeam1;
                    const posLabel = p?.position ? p.position : '—';
                    return (
                      <div key={`t1-${rowIndex}-${colIndex}`} className="flex items-center gap-1 min-w-0">
                        {show && p ? (
                          <>
                            <span className="text-[9px] text-gray-400 shrink-0 w-6" title={p.position ? undefined : 'Position from AFL website when available'}>{posLabel}</span>
                            <span className="text-xs font-bold shrink-0 w-5" style={{ color: color1 }}>{p.number}</span>
                            <span className="text-[10px] truncate text-white" title={formatNameFirstLast(p.name)}>{compactName(p.name, 12)}</span>
                          </>
                        ) : (
                          <span className="text-[9px] text-gray-500">—</span>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              ))}
            </div>
            <div className={`h-px ${isDark ? 'bg-gray-600' : 'bg-gray-400'}`} />
            {/* Team 2 – 5 rows of 3 */}
            <div className="p-2">
              <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} style={{ color: color2 }}>
                {team2Label}
              </p>
              {placedTeam2.map((rowPlayers, rowIndex) => (
                <div key={`t2-r${rowIndex}`} className="mb-1.5 last:mb-0">
                  <span className={`text-[9px] uppercase ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{ROW_LABELS[rowIndex]}</span>
                  <div className="grid grid-cols-3 gap-1 mt-0.5">
                  {(ROW_POSITIONS[rowIndex] ?? ['—', '—', '—']).map((pos, colIndex) => {
                    const p = rowPlayers[colIndex];
                    const show = showTeam2;
                    const posLabel = p?.position ? p.position : '—';
                    return (
                      <div key={`t2-${rowIndex}-${colIndex}`} className="flex items-center gap-1 min-w-0">
                        {show && p ? (
                          <>
                            <span className="text-[9px] text-gray-400 shrink-0 w-6" title={p.position ? undefined : 'Position from AFL website when available'}>{posLabel}</span>
                            <span className="text-xs font-bold shrink-0 w-5" style={{ color: color2 }}>{p.number}</span>
                            <span className="text-[10px] truncate text-white" title={formatNameFirstLast(p.name)}>{compactName(p.name, 12)}</span>
                          </>
                        ) : (
                          <span className="text-[9px] text-gray-500">—</span>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Interchanges + Substitutes (right) */}
        <div className="w-24 shrink-0 flex flex-col gap-2">
          <div
            className={`flex-1 rounded-lg p-2 flex flex-col min-h-0 ${isDark ? 'bg-[#1e293b]' : 'bg-white'} border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
          >
            <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              Interchanges
            </p>
            <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
              {(showTeam1 ? team1Interchange : [])
                .map((p, i) => (
                  <div
                    key={`i1-${i}`}
                    className={`rounded px-1.5 py-1 text-[10px] border-l-2 ${isDark ? 'bg-[#0a1929]' : 'bg-gray-50'}`}
                    style={{ borderLeftColor: color1 }}
                  >
                    <span className="font-semibold" style={{ color: color1 }}>{p.number ?? '—'}</span>
                    <span className={`block truncate text-[10px] ${isDark ? 'text-gray-300' : 'text-gray-800'}`} title={formatNameFirstLast(p.name)}>{compactName(p.name, 12)}</span>
                  </div>
                ))}
              {(showTeam2 ? team2Interchange : [])
                .map((p, i) => (
                  <div
                    key={`i2-${i}`}
                    className={`rounded px-1.5 py-1 text-[10px] border-l-2 ${isDark ? 'bg-[#0a1929]' : 'bg-gray-50'}`}
                    style={{ borderLeftColor: color2 }}
                  >
                    <span className="font-semibold" style={{ color: color2 }}>{p.number ?? '—'}</span>
                    <span className={`block truncate text-[10px] ${isDark ? 'text-gray-300' : 'text-gray-800'}`} title={formatNameFirstLast(p.name)}>{compactName(p.name, 12)}</span>
                  </div>
                ))}
            </div>
          </div>
          {allSubs.length > 0 && (
            <div
              className={`rounded-lg p-2 flex flex-col shrink-0 ${isDark ? 'bg-[#1e293b]' : 'bg-white'} border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
            >
              <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                Substitutes
              </p>
              <div className="flex flex-col gap-1">
                {allSubs.map((p, i) => {
                  const team1Count = showTeam1 ? team1Subs.length : 0;
                  const isTeam1 = i < team1Count;
                  return (
                    <div
                      key={`s-${i}`}
                      className={`rounded px-1.5 py-1 text-[10px] border-l-2 ${isDark ? 'bg-[#0a1929]' : 'bg-gray-50'}`}
                      style={{ borderLeftColor: isTeam1 ? color1 : color2 }}
                    >
                      <span className="font-semibold" style={{ color: isTeam1 ? color1 : color2 }}>
                        {p.number ?? '—'}
                      </span>
                      <span className={`block truncate text-[10px] ${isDark ? 'text-gray-300' : 'text-gray-800'}`} title={formatNameFirstLast(p.name)}>{compactName(p.name, 12)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
