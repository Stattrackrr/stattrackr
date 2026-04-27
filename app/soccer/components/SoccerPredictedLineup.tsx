'use client';

import type { SoccerwayLineupBundle, SoccerwayLineupPlayer, SoccerwayLineupTeam } from '@/lib/soccerwayTeamResults';

type SoccerPredictedLineupProps = {
  lineup: SoccerwayLineupBundle | null;
  isDark: boolean;
  /** When the next-fixture lineups are empty, we may show the last match instead. */
  lineupFrom?: 'upcoming' | 'previous';
};

function formatPlayerLabel(player: SoccerwayLineupPlayer): string {
  const number = player.number ? `${player.number} ` : '';
  return `${number}${player.fieldName}`.trim();
}

function getPlayerInitials(player: SoccerwayLineupPlayer): string {
  const source = player.fieldName || player.listName;
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getFormationRows(team: SoccerwayLineupTeam): Array<{ sortKey: number; players: SoccerwayLineupPlayer[] }> {
  return [...team.formationLines]
    .sort((a, b) => a.sortKey - b.sortKey)
    .flatMap((line) => [...line.rows].sort((a, b) => a.sortKey - b.sortKey))
    .filter((row) => row.players.length > 0);
}

function getPlayerPosition(
  side: SoccerwayLineupTeam['side'],
  rowIndex: number,
  playerIndex: number,
  playersInRow: number,
  totalRows: number
): { xPercent: number; yPercent: number } {
  const keeperX = side === 'home' ? 8 : 92;
  const outfieldStart = 20;
  const outfieldEnd = 82;
  const outfieldRows = Math.max(totalRows - 1, 1);
  const outfieldStep = outfieldRows <= 1 ? 0 : (outfieldEnd - outfieldStart) / (outfieldRows - 1);
  const outfieldIndex = Math.max(rowIndex - 1, 0);
  const generalOutfieldPush = rowIndex > 0 ? 4 : 0;
  const defensiveLinePush = rowIndex === 1 ? 4 : 0;
  const totalPush = generalOutfieldPush + defensiveLinePush;
  const xPercent =
    rowIndex === 0
      ? keeperX
      : side === 'home'
        ? outfieldStart + outfieldIndex * outfieldStep + totalPush
        : outfieldEnd - outfieldIndex * outfieldStep - totalPush;

  const rowBands: Record<number, [number, number]> = {
    1: [50, 50],
    2: [36, 64],
    3: [24, 76],
    4: [16, 84],
    5: [12, 88],
  };
  const [yTop, yBottom] = rowBands[playersInRow] ?? [16, 84];
  const yStep = playersInRow <= 1 ? 0 : (yBottom - yTop) / (playersInRow - 1);
  const yPercent = yTop + playerIndex * yStep;

  return { xPercent, yPercent };
}

function PositionedTeam({
  team,
  isDark,
}: {
  team: SoccerwayLineupTeam;
  isDark: boolean;
}) {
  const rows = getFormationRows(team);

  if (rows.length === 0) return null;

  return (
    <>
      {rows.map((row, rowIndex) =>
        row.players.map((player, playerIndex) => {
          const { xPercent, yPercent } = getPlayerPosition(team.side, rowIndex, playerIndex, row.players.length, rows.length);
          const sideBase = team.side === 'home' ? 4 : 56;
          const sideWidth = 40;
          const leftPercent = sideBase + (xPercent / 100) * sideWidth;

          return (
            <div
              key={player.id}
              className="absolute z-10"
              style={{
                left: `${leftPercent}%`,
                top: `${yPercent}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <PlayerMarker player={player} isDark={isDark} />
            </div>
          );
        })
      )}
    </>
  );
}

function PlayerMarker({ player, isDark }: { player: SoccerwayLineupPlayer; isDark: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`relative h-9 w-9 overflow-hidden rounded-full border-2 shadow-[0_8px_18px_rgba(0,0,0,0.3)] sm:h-10 sm:w-10 ${
          isDark ? 'border-white/20 bg-slate-800' : 'border-white/70 bg-slate-700'
        }`}
      >
        {player.imageUrl ? (
          <img src={player.imageUrl} alt={player.listName} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase text-white sm:text-xs">
            {getPlayerInitials(player)}
          </div>
        )}
      </div>
      <div className="max-w-[76px] rounded-md bg-black/80 px-1.5 py-1 text-center text-white shadow-[0_6px_14px_rgba(0,0,0,0.25)] sm:max-w-[92px]">
        <div className="truncate text-[10px] font-semibold leading-none sm:text-[11px]">{formatPlayerLabel(player)}</div>
      </div>
    </div>
  );
}

function CombinedPitch({
  homeTeam,
  awayTeam,
  isDark,
}: {
  homeTeam: SoccerwayLineupTeam;
  awayTeam: SoccerwayLineupTeam;
  isDark: boolean;
}) {
  return (
    <div className="px-3 sm:px-4">
      <div
        className={`rounded-xl border p-3 sm:p-4 ${
          isDark ? 'border-white/10 bg-[#07131f]' : 'border-gray-200 bg-gray-50/80'
        }`}
      >
        <div className="mb-3 flex items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="min-w-0">
            <div className={`truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{homeTeam.name}</div>
            <div className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{homeTeam.formationName ?? `${homeTeam.starters.length} starters`}</div>
          </div>
          <div className={`text-[10px] sm:text-xs uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Formation</div>
          <div className="min-w-0 text-right">
            <div className={`truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{awayTeam.name}</div>
            <div className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{awayTeam.formationName ?? `${awayTeam.starters.length} starters`}</div>
          </div>
        </div>

        <div
          className={`relative overflow-hidden rounded-2xl border ${
            isDark
              ? 'border-white/10 bg-[#1f5f36]'
              : 'border-gray-300 bg-[#2f7d46]'
          }`}
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-[2.5%] top-[3%] bottom-[5%] border border-white/25" />
            <div className="absolute left-1/2 top-[3%] bottom-[5%] border-l border-white/30" />
            <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20" />
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30" />
            <div className="absolute left-[2.5%] top-[32%] h-[28%] w-[8%] border border-l-0 border-white/20" />
            <div className="absolute right-[2.5%] top-[32%] h-[28%] w-[8%] border border-r-0 border-white/20" />
            <div className="absolute left-[2.5%] top-[40%] h-[12%] w-[2%] border border-l-0 border-white/20" />
            <div className="absolute right-[2.5%] top-[40%] h-[12%] w-[2%] border border-r-0 border-white/20" />
          </div>

          <div className="relative h-[300px] sm:h-[340px] lg:h-[380px]">
            <PositionedTeam team={homeTeam} isDark={isDark} />
            <PositionedTeam team={awayTeam} isDark={isDark} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SingleTeamPitch({ team, isDark }: { team: SoccerwayLineupTeam; isDark: boolean }) {
  return (
    <div className="px-3 sm:px-4">
      <div
        className={`rounded-xl border p-3 sm:p-4 ${
          isDark ? 'border-white/10 bg-[#07131f]' : 'border-gray-200 bg-gray-50/80'
        }`}
      >
        <div className="mb-3">
          <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{team.name}</div>
          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {team.formationName ?? `${team.starters.length} starters`}
          </div>
        </div>
        <div
          className={`relative overflow-hidden rounded-2xl border ${
            isDark
              ? 'border-white/10 bg-[#1f5f36]'
              : 'border-gray-300 bg-[#2f7d46]'
          }`}
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-[8%] top-[6%] bottom-[8%] rounded-[28px] border border-white/25" />
            <div className="absolute left-1/2 top-[6%] bottom-[8%] border-l border-white/20" />
            <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20" />
          </div>
          <div className="relative h-[300px] sm:h-[340px]">
            {getFormationRows(team).map((row, rowIndex, rows) =>
              row.players.map((player, playerIndex) => {
                const { xPercent, yPercent } = getPlayerPosition(team.side, rowIndex, playerIndex, row.players.length, rows.length);
                return (
                  <div
                    key={player.id}
                    className="absolute z-10"
                    style={{
                      left: `${xPercent}%`,
                      top: `${yPercent}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <PlayerMarker player={player} isDark={isDark} />
                  </div>
                );
              })
            )}
            {getFormationRows(team).length === 0 ? (
              <div className="grid h-full place-items-center px-4">
                <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-200'}`}>No formation layout available.</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SoccerPredictedLineup({ lineup, isDark, lineupFrom = 'upcoming' }: SoccerPredictedLineupProps) {
  const teams =
    lineup?.teams.filter(
      (team) => team.starters.length > 0 || team.formationLines.length > 0 || team.substitutes.length > 0 || team.coaches.length > 0
    ) ?? [];
  const isPrevious = lineupFrom === 'previous';
  const statusLabel =
    lineup?.status === 'official'
      ? 'Official lineups'
      : lineup?.status === 'predicted'
        ? 'Predicted lineups'
        : 'No lineup available';
  const titleLabel = isPrevious
    ? 'Most Recent Lineup'
    : lineup?.status === 'official' || lineup?.status === 'predicted'
      ? `Lineups - ${statusLabel}`
      : 'Lineups';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center px-3 sm:px-4">
        <div className={`text-center text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{titleLabel}</div>
      </div>

      {teams.length === 0 ? (
        <div className={`px-3 pb-2 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No data available come back later</div>
      ) : teams.length >= 2 ? (
        <CombinedPitch
          homeTeam={teams.find((team) => team.side === 'home') ?? teams[0]}
          awayTeam={teams.find((team) => team.side === 'away') ?? teams[1]}
          isDark={isDark}
        />
      ) : (
        <SingleTeamPitch team={teams[0]} isDark={isDark} />
      )}
    </div>
  );
}
