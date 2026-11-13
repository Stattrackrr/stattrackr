/**
 * Shared helpers for the dashed "next game" bar on NBA / NBL stats charts.
 */

export type UpcomingRankRow = {
  key: string;
  label: string;
  rank: number | null;
  /** Formatted amount the opponent allows (e.g. "21.9", "47%"). */
  allowed?: string | null;
};

/** Format a raw DVP allowed number for tooltip display. */
export function formatDvpAllowedValue(
  metric: string,
  value: number | null | undefined
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (metric.includes('pct') || metric.endsWith('_pct')) {
    const pct = value <= 1 ? value * 100 : value;
    return `${Math.round(pct * 10) / 10}%`;
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Team-level allowed rate for the selected chart stat (not position DVP). */
export type UpcomingTeamAllowed = {
  /** Short metric label, e.g. "Pts/g" — team name lives in the section header. */
  label: string;
  /** Formatted average, e.g. "112.4" or "47.2%" */
  value: string;
  rank: number | null;
  /** Club short name for the Team Allowed header (e.g. "Pacers"). */
  teamName?: string | null;
};

export type UpcomingGameBarContext = {
  opponent: string;
  tipoff: string | null;
  isHome: boolean | null;
  /** Player/team spread (negative = favourite). */
  spread: number | null;
  total: number | null;
  expectedMinutes: number | null;
  expectedMinutesLow: number | null;
  expectedMinutesHigh: number | null;
  usagePct: number | null;
  pace: number | null;
  /** Recent-form average potential rebounds (reb chances). */
  avgPotentialRebounds?: number | null;
  /** Opponent team allowed/g rows (selected stat + OReb/DReb on rebound props). */
  teamAllowedRows?: UpcomingTeamAllowed[] | null;
  /** @deprecated use teamAllowedRows */
  teamAllowed?: UpcomingTeamAllowed | null;
  /** Optional opponent ranking rows (DVP / STE). */
  ranks?: UpcomingRankRow[];
};

/** Map chart selectedStat → STE / team-allowed metric key. */
export function steMetricForSelectedStat(selectedStat?: string | null): string | null {
  const s = String(selectedStat || '').toLowerCase().trim();
  if (!s) return 'pts';
  if (s === 'oreb' || s.includes('oreb') || s.includes('offensive_reb')) return 'oreb';
  if (s === 'dreb' || s.includes('dreb') || s.includes('defensive_reb')) return 'dreb';
  if (s.includes('fg3_pct') || s.includes('3pt_pct') || s === 'fg3pct') return 'fg3_pct';
  if (s.includes('fg_pct') || s === 'fgpct' || s === 'fg%') return 'fg_pct';
  if (s === 'fga' || s.includes('fga')) return 'fga';
  if (s === 'fgm' || s.includes('fgm')) return 'fgm';
  const family = familyOfStat(selectedStat);
  switch (family) {
    case 'rebounds':
      return 'reb';
    case 'assists':
      return 'ast';
    case 'threes':
      return 'fg3m';
    case 'steals':
      return 'stl';
    case 'blocks':
      return 'blk';
    case 'points':
    default:
      return 'pts';
  }
}

export function steMetricShortLabel(metric: string): string {
  switch (metric) {
    case 'pts':
      return 'Pts';
    case 'reb':
      return 'Reb';
    case 'oreb':
      return 'OReb';
    case 'dreb':
      return 'DReb';
    case 'ast':
      return 'Ast';
    case 'stl':
      return 'Stl';
    case 'blk':
      return 'Blk';
    case 'fg3m':
      return '3PM';
    case 'fgm':
      return 'FGM';
    case 'fga':
      return 'FGA';
    case 'fg_pct':
      return 'FG%';
    case 'fg3_pct':
      return '3PT%';
    default:
      return metric.toUpperCase();
  }
}

/** Build the team-allowed row for the upcoming tooltip. */
export function buildUpcomingTeamAllowed(params: {
  shortName: string | null | undefined;
  metric: string | null | undefined;
  value: number | null | undefined;
  rank?: number | null;
}): UpcomingTeamAllowed | null {
  const metric = String(params.metric || '').trim();
  const shortName = String(params.shortName || '').trim();
  if (!metric || !shortName) return null;
  const value = formatDvpAllowedValue(metric, params.value);
  if (!value) return null;
  const isPct = metric.includes('pct');
  const short = steMetricShortLabel(metric);
  return {
    label: isPct ? short : `${short}/g`,
    value,
    rank:
      typeof params.rank === 'number' && Number.isFinite(params.rank) ? params.rank : null,
    teamName: shortName,
  };
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = avg(values);
  if (mean == null) return null;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Recent-log estimates for the upcoming-game tooltip (AI-style L5 form). */
export function estimateUpcomingFromLogs(
  logs: Array<Record<string, unknown>>,
  window = 5
): Pick<
  UpcomingGameBarContext,
  | 'expectedMinutes'
  | 'expectedMinutesLow'
  | 'expectedMinutesHigh'
  | 'usagePct'
  | 'pace'
  | 'avgPotentialRebounds'
> {
  const recent = [...logs]
    .map((g) => ({
      date: String(g.date ?? g.game_date ?? ''),
      minutes: num(g.minutes),
      usg: num(g.usgPct),
      pace: num(g.pace),
      potReb: num(g.potentialRebounds ?? g.rebChances ?? g.reboundChances),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, window);

  const minutes = recent.map((r) => r.minutes).filter((v): v is number => v != null && v > 0);
  const usg = recent.map((r) => r.usg).filter((v): v is number => v != null && v > 0);
  const pace = recent.map((r) => r.pace).filter((v): v is number => v != null && v > 0);
  const potReb = recent.map((r) => r.potReb).filter((v): v is number => v != null && v > 0);

  const meanMin = avg(minutes);
  // Tight band around recent form (not season min/max): ~±2–3 mins.
  const spread =
    meanMin == null
      ? null
      : Math.max(2, Math.min(3, Math.round((stdev(minutes) ?? 2.5) * 10) / 10));
  const meanPotReb = avg(potReb);

  return {
    expectedMinutes: meanMin == null ? null : Math.round(meanMin),
    expectedMinutesLow:
      meanMin == null || spread == null ? null : Math.max(0, Math.round(meanMin - spread)),
    expectedMinutesHigh:
      meanMin == null || spread == null ? null : Math.round(meanMin + spread),
    usagePct: avg(usg) == null ? null : Math.round((avg(usg) as number) * 10) / 10,
    pace: avg(pace) == null ? null : Math.round((avg(pace) as number) * 10) / 10,
    avgPotentialRebounds:
      meanPotReb == null ? null : Math.round(meanPotReb * 10) / 10,
  };
}

export function formatUpcomingMatchup(
  opponent: string,
  isHome: boolean | null
): string {
  const opp = String(opponent || '').trim() || 'Opponent';
  if (isHome === true) return `vs ${opp}`;
  if (isHome === false) return `@ ${opp}`;
  return `vs ${opp}`;
}

export function rankTone(rank: number | null): 'good' | 'ok' | 'bad' | 'empty' {
  if (rank == null || !Number.isFinite(rank)) return 'empty';
  if (rank <= 10) return 'bad';
  if (rank <= 20) return 'ok';
  return 'good';
}

/** Color for opponent rank pills: low rank # = tough (red), high = soft (green). */
export function rankPillColors(rank: number | null, isDark: boolean): { bg: string; text: string } {
  const tone = rankTone(rank);
  if (tone === 'bad') {
    return isDark
      ? { bg: 'rgba(239,68,68,0.18)', text: '#f87171' }
      : { bg: 'rgba(239,68,68,0.12)', text: '#dc2626' };
  }
  if (tone === 'ok') {
    return isDark
      ? { bg: 'rgba(245,158,11,0.18)', text: '#fbbf24' }
      : { bg: 'rgba(245,158,11,0.14)', text: '#d97706' };
  }
  if (tone === 'good') {
    return isDark
      ? { bg: 'rgba(16,185,129,0.18)', text: '#34d399' }
      : { bg: 'rgba(16,185,129,0.12)', text: '#059669' };
  }
  return isDark
    ? { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8' }
    : { bg: 'rgba(148,163,184,0.16)', text: '#64748b' };
}

export function familyOfStat(selectedStat: string | null | undefined): string {
  const s = String(selectedStat || '').toLowerCase();
  if (!s) return 'points';
  if (s === 'rebounds' || s === 'reb' || /^q[1-4]_reb$/.test(s) || s.includes('reb')) return 'rebounds';
  if (s === 'assists' || s === 'ast' || /^q[1-4]_ast$/.test(s) || s.includes('ast')) return 'assists';
  if (s === 'threemade' || s === 'fg3m' || s.includes('three') || s.includes('fg3')) return 'threes';
  if (s === 'steals' || s === 'stl') return 'steals';
  if (s === 'blocks' || s === 'blk') return 'blocks';
  if (s === 'pra' || s === 'pr' || s === 'pa') return 'points';
  if (s === 'ra') return 'rebounds';
  if (s === 'points' || s === 'pts' || /^q[1-4]_pts$/.test(s) || s.includes('point')) return 'points';
  return 'points';
}

/** DVP metrics to batch-fetch for the upcoming tooltip (position defense). */
export function dvpMetricsForStat(selectedStat?: string | null): string[] {
  const family = familyOfStat(selectedStat);
  switch (family) {
    case 'rebounds':
      return ['reb'];
    case 'assists':
      return ['ast'];
    case 'threes':
      return ['fg3m', 'fg3_pct'];
    case 'steals':
      return ['stl'];
    case 'blocks':
      return ['blk'];
    case 'points':
    default:
      return ['pts', 'fg_pct', 'fg3m'];
  }
}

/**
 * Build opponent ranking rows from position DVP ranks
 * (`metric -> opponent rank` for the player's position).
 */
/** Team STE OReb/DReb rows for the Team Allowed section. */
export function buildSteReboundSplitTeamAllowed(params: {
  shortName: string | null | undefined;
  opponentCode: string | null | undefined;
  metrics?: Record<
    string,
    { ranks?: Record<string, number>; values?: Record<string, number> } | undefined
  > | null;
}): UpcomingTeamAllowed[] {
  const code = params.opponentCode;
  const shortName = String(params.shortName || '').trim();
  if (!code || !shortName || !params.metrics) return [];
  const out: UpcomingTeamAllowed[] = [];
  for (const key of ['oreb', 'dreb'] as const) {
    const row = buildUpcomingTeamAllowed({
      shortName,
      metric: key,
      value: params.metrics?.[key]?.values?.[code],
      rank: params.metrics?.[key]?.ranks?.[code],
    });
    if (row) out.push(row);
  }
  return out;
}

/** Normalize a free-text position to PG/SG/SF/PF/C for DVP labels. */
export function dvpPositionLabel(position?: string | null): string | null {
  const raw = String(position || '').toUpperCase().trim();
  if (!raw) return null;
  if ((['PG', 'SG', 'SF', 'PF', 'C'] as const).includes(raw as 'PG')) return raw;
  const first = raw.split(/[\/\-\s,]/)[0]?.trim() || '';
  return (['PG', 'SG', 'SF', 'PF', 'C'] as const).find((p) => p === first) || null;
}

export function buildUpcomingOpponentRanks(params: {
  selectedStat?: string | null;
  /** Player position — labels become "Reb to PF". */
  position?: string | null;
  /** Flat DVP ranks for the opponent at the player's position. */
  dvpRanks?: Record<string, number | null> | null;
  /** Flat DVP allowed-per-game values for the opponent at the player's position. */
  dvpAllowed?: Record<string, number | null> | null;
  shotZone?: {
    key: string;
    label: string;
    rank: number | null;
    allowed?: string | null;
  } | null;
  assistZone?: {
    key: string;
    label: string;
    rank: number | null;
    allowed?: string | null;
  } | null;
}): UpcomingRankRow[] {
  const ranks = params.dvpRanks || {};
  const allowed = params.dvpAllowed || {};
  const family = familyOfStat(params.selectedStat);
  const pos = dvpPositionLabel(params.position);
  const toPos = (statLabel: string) => (pos ? `${statLabel} to ${pos}` : statLabel);
  const row = (key: string, label: string): UpcomingRankRow => {
    const rank = ranks[key];
    return {
      key,
      label,
      rank: typeof rank === 'number' && Number.isFinite(rank) ? rank : null,
      allowed: formatDvpAllowedValue(key, allowed[key]),
    };
  };

  if (family === 'rebounds') {
    return [row('reb', toPos('Reb'))];
  }

  if (family === 'assists') {
    const base: UpcomingRankRow[] = [row('ast', toPos('Ast'))];
    if (params.assistZone) {
      base.push({
        key: `ast-zone-${params.assistZone.key}`,
        label: `${params.assistZone.label} Ast`,
        rank: params.assistZone.rank,
        allowed: params.assistZone.allowed ?? null,
      });
    }
    return base;
  }

  if (family === 'threes') {
    const rows: UpcomingRankRow[] = [row('fg3m', toPos('3PM')), row('fg3_pct', toPos('3PT%'))];
    if (params.shotZone) {
      rows.push({
        key: `zone-${params.shotZone.key}`,
        label: params.shotZone.label,
        rank: params.shotZone.rank,
        allowed: params.shotZone.allowed ?? null,
      });
    }
    return rows;
  }

  if (family === 'steals') {
    return [row('stl', toPos('Stl'))];
  }

  if (family === 'blocks') {
    return [row('blk', toPos('Blk'))];
  }

  // Points / PRA / default — keep scoring-only context (no Ast/etc).
  const rows: UpcomingRankRow[] = [
    row('pts', toPos('Pts')),
    row('fg_pct', toPos('FG%')),
    row('fg3m', toPos('3PM')),
  ];
  if (params.shotZone) {
    rows.push({
      key: `zone-${params.shotZone.key}`,
      label: params.shotZone.label,
      rank: params.shotZone.rank,
      allowed: params.shotZone.allowed ?? null,
    });
  }
  return rows;
}

/**
 * Fallback when position DVP is unavailable (e.g. NBL): team STE allowed ranks.
 * Points family uses FG% instead of FGM/FGA.
 */
export function buildUpcomingOpponentRanksFromSte(params: {
  selectedStat?: string | null;
  opponentCode: string | null;
  metrics?: Record<
    string,
    { ranks?: Record<string, number>; values?: Record<string, number> } | undefined
  > | null;
  shotZone?: {
    key: string;
    label: string;
    rank: number | null;
    allowed?: string | null;
  } | null;
  assistZone?: {
    key: string;
    label: string;
    rank: number | null;
    allowed?: string | null;
  } | null;
}): UpcomingRankRow[] {
  const code = params.opponentCode;
  if (!code) return [];
  const metrics = params.metrics;
  const family = familyOfStat(params.selectedStat);
  const steRank = (key: string): number | null => {
    const rank = metrics?.[key]?.ranks?.[code];
    return typeof rank === 'number' && Number.isFinite(rank) ? rank : null;
  };
  const steAllowed = (key: string): string | null => {
    const value = metrics?.[key]?.values?.[code];
    return formatDvpAllowedValue(key, typeof value === 'number' ? value : null);
  };
  const row = (key: string, label: string): UpcomingRankRow => ({
    key,
    label,
    rank: steRank(key),
    allowed: steAllowed(key),
  });

  if (family === 'rebounds') {
    // OReb/DReb live under Team Allowed (team STE), not this DVP/STE ranks block.
    return [row('reb', 'Reb Allowed')];
  }
  if (family === 'assists') {
    const base: UpcomingRankRow[] = [row('ast', 'Ast Allowed')];
    if (params.assistZone) {
      base.push({
        key: `ast-zone-${params.assistZone.key}`,
        label: `${params.assistZone.label} Ast`,
        rank: params.assistZone.rank,
        allowed: params.assistZone.allowed ?? null,
      });
    }
    return base;
  }
  if (family === 'threes') {
    const rows: UpcomingRankRow[] = [
      row('fg3m', '3PM Allowed'),
      row('fg3_pct', '3PT% Allowed'),
    ];
    if (params.shotZone) {
      rows.push({
        key: `zone-${params.shotZone.key}`,
        label: params.shotZone.label,
        rank: params.shotZone.rank,
        allowed: params.shotZone.allowed ?? null,
      });
    }
    return rows;
  }
  if (family === 'steals') {
    return [row('stl', 'Stl Allowed')];
  }
  if (family === 'blocks') {
    return [row('blk', 'Blk Allowed')];
  }
  const rows: UpcomingRankRow[] = [
    row('pts', 'Pts Allowed'),
    row('fg_pct', 'FG% Allowed'),
    row('fg3m', '3PM Allowed'),
  ];
  if (params.shotZone) {
    rows.push({
      key: `zone-${params.shotZone.key}`,
      label: params.shotZone.label,
      rank: params.shotZone.rank,
      allowed: params.shotZone.allowed ?? null,
    });
  }
  return rows;
}

function zonePointValue(zoneKey: string): number {
  const k = zoneKey.toLowerCase();
  if (k.includes('3') || k.includes('three') || k.includes('corner') || k.includes('break')) return 3;
  return 2;
}

/** Pick the player's highest-scoring shot zone from a player shot-chart payload. */
export function pickHighestScoringShotZone(
  zones: Array<{ zone?: string; label?: string; fgm?: number; pts?: number; fga?: number }> | null | undefined
): { key: string; label: string } | null {
  if (!Array.isArray(zones) || !zones.length) return null;
  let best: { key: string; label: string; score: number } | null = null;
  for (const z of zones) {
    const key = String(z.zone || '').trim();
    if (!key) continue;
    const label = String(z.label || key).trim();
    const fgm = typeof z.fgm === 'number' && Number.isFinite(z.fgm) ? z.fgm : 0;
    const score =
      typeof z.pts === 'number' && Number.isFinite(z.pts)
        ? z.pts
        : fgm * zonePointValue(key);
    if (!best || score > best.score) best = { key, label, score };
  }
  return best && best.score > 0 ? { key: best.key, label: best.label } : null;
}
