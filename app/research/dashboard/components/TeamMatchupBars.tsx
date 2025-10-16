"use client";

import React from "react";

export type MatchupDatum = {
  metric: string;
  playerTeamValue: number;
  playerTeamRank: number;
  opponentTeamValue: number;
  opponentTeamRank: number;
  isHigherBetter: boolean;
};

type Props = {
  playerTeam?: string | null;
  opponentTeam?: string | null;
  themeDark?: boolean;
  matchupData: MatchupDatum[];
};

export function TeamMatchupBars({ playerTeam, opponentTeam, themeDark = false, matchupData }: Props) {
  // Simple horizontal bar comparison for each metric
  return (
    <div className={themeDark ? "text-slate-200" : "text-slate-800"}>
      <div className="mb-2 text-xs font-mono">
        {playerTeam || '—'} vs {opponentTeam || '—'}
      </div>
      <div className="space-y-2">
        {matchupData.map((m) => {
          const total = Math.max(1e-6, Math.abs(m.playerTeamValue) + Math.abs(m.opponentTeamValue));
          const leftPct = Math.max(2, Math.round((Math.abs(m.playerTeamValue) / total) * 100));
          const rightPct = Math.max(2, 100 - leftPct);
          const betterLeft = m.isHigherBetter ? m.playerTeamValue >= m.opponentTeamValue : m.playerTeamValue <= m.opponentTeamValue;
          const leftColor = betterLeft ? (themeDark ? "bg-emerald-600" : "bg-emerald-500") : (themeDark ? "bg-slate-700" : "bg-slate-300");
          const rightColor = !betterLeft ? (themeDark ? "bg-emerald-600" : "bg-emerald-500") : (themeDark ? "bg-slate-700" : "bg-slate-300");
          return (
            <div key={m.metric} className={(themeDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200") + " border rounded-md p-2"}>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold">{m.metric}</div>
                <div className="text-[10px] font-mono">
                  {playerTeam || '—'} #{m.playerTeamRank} · {opponentTeam || '—'} #{m.opponentTeamRank}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
                <div className={themeDark ? "text-slate-300" : "text-slate-700"}>{m.playerTeamValue}</div>
                <div className={(themeDark ? "text-slate-300" : "text-slate-700") + " text-right"}>{m.opponentTeamValue}</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-3 rounded overflow-hidden flex">
                  <div className={`${leftColor} h-full`} style={{ width: `${leftPct}%` }}></div>
                  <div className={`${rightColor} h-full`} style={{ width: `${rightPct}%` }}></div>
                </div>
                <div className="text-[10px] font-mono whitespace-nowrap">{leftPct}% · {rightPct}%</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
