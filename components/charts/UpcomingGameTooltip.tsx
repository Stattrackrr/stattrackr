'use client';

import type { CSSProperties, JSX } from 'react';
import {
  formatUpcomingMatchup,
  rankPillColors,
  type UpcomingGameBarContext,
  type UpcomingTeamAllowed,
} from '@/lib/charts/upcomingGameBar';

function formatSignedLine(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n > 0 ? `+${n}` : String(n);
}

function formatTipoffDate(tipoff: string | null): string {
  if (!tipoff) return '';
  const ts = Date.parse(tipoff);
  if (Number.isNaN(ts)) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function MetaRow({
  label,
  value,
  labelColor,
  valueColor,
}: {
  label: string;
  value: string;
  labelColor: string;
  valueColor: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'baseline',
        columnGap: 12,
        minHeight: 18,
      }}
    >
      <span style={{ fontSize: 12, color: labelColor, lineHeight: 1.2 }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function RankedRow({
  label,
  value,
  rank,
  labelColor,
  valueColor,
  isDark,
}: {
  label: string;
  value: string | null;
  rank: number | null;
  labelColor: string;
  valueColor: string;
  isDark: boolean;
}) {
  const pill = rankPillColors(rank, isDark);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 36px',
        alignItems: 'center',
        columnGap: 8,
        minHeight: 20,
      }}
    >
      <span style={{ fontSize: 12, color: labelColor, lineHeight: 1.2 }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
          textAlign: 'right',
        }}
      >
        {value || '—'}
      </span>
      <span
        style={{
          justifySelf: 'end',
          minWidth: 36,
          textAlign: 'center',
          fontSize: 10,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: pill.text,
          backgroundColor: pill.bg,
          borderRadius: 6,
          padding: '2px 0',
          lineHeight: 1.25,
        }}
      >
        {rank != null ? `#${rank}` : '—'}
      </span>
    </div>
  );
}

function SectionTitle({
  title,
  labelColor,
  borderColor,
}: {
  title: string;
  labelColor: string;
  borderColor: string;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: `1px solid ${borderColor}`,
        marginBottom: 6,
        fontSize: 10,
        fontWeight: 600,
        color: labelColor,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}
    >
      {title}
    </div>
  );
}

/**
 * Upcoming-game hover card — compact, aligned columns.
 */
export function UpcomingGameTooltipCard({
  ctx,
  isDark,
  isMobile,
  style,
  rankingsTitle = 'Opponent DVP',
}: {
  ctx: UpcomingGameBarContext;
  isDark: boolean;
  isMobile?: boolean;
  style?: CSSProperties;
  rankingsTitle?: string;
}) {
  const tooltipBg = isDark ? '#111827' : '#ffffff';
  const tooltipText = isDark ? '#f3f4f6' : '#111827';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const muted = isDark ? '#6b7280' : '#9ca3af';
  const matchup = formatUpcomingMatchup(ctx.opponent, ctx.isHome);
  const dateShort = formatTipoffDate(ctx.tipoff);
  const spreadLabel = formatSignedLine(ctx.spread);
  const hasSpread = ctx.spread != null && Number.isFinite(ctx.spread);

  const minsLabel =
    ctx.expectedMinutes != null && Number.isFinite(ctx.expectedMinutes)
      ? `${Math.max(0, ctx.expectedMinutes - 2)}-${ctx.expectedMinutes + 2}`
      : '—';

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Spread', value: hasSpread ? spreadLabel : '—' },
    { label: 'Total Points', value: ctx.total != null ? String(ctx.total) : '—' },
    { label: 'Est. Minutes', value: minsLabel },
    { label: 'Est. Usage', value: ctx.usagePct != null ? `${ctx.usagePct}%` : '—' },
    { label: 'Est. Pace', value: ctx.pace != null ? String(ctx.pace) : '—' },
  ];
  if (ctx.avgPotentialRebounds != null && Number.isFinite(ctx.avgPotentialRebounds)) {
    rows.push({
      label: 'Avg. Pot. Reb',
      value: String(ctx.avgPotentialRebounds),
    });
  }

  const teamAllowedRows: UpcomingTeamAllowed[] = Array.isArray(ctx.teamAllowedRows)
    ? ctx.teamAllowedRows
    : ctx.teamAllowed
      ? [ctx.teamAllowed]
      : [];
  const teamName =
    teamAllowedRows.find((r) => r.teamName)?.teamName ||
    null;
  const ranks = Array.isArray(ctx.ranks) ? ctx.ranks : [];

  return (
    <div
      style={{
        backgroundColor: tooltipBg,
        border: `1px solid ${tooltipBorder}`,
        borderRadius: 10,
        padding: '10px 12px',
        width: isMobile ? 'min(260px, 90vw)' : '232px',
        boxShadow: isDark
          ? '0 10px 24px -8px rgba(0, 0, 0, 0.55)'
          : '0 10px 24px -8px rgba(15, 23, 42, 0.16)',
        pointerEvents: 'none',
        ...style,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 2,
          }}
        >
          {dateShort ? (
            <span style={{ fontSize: 10, fontWeight: 500, color: muted }}>{dateShort}</span>
          ) : null}
          <span style={{ fontSize: 10, fontWeight: 500, color: muted }}>Upcoming</span>
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: tooltipText,
            lineHeight: 1.25,
          }}
        >
          {matchup}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((row) => (
          <MetaRow
            key={row.label}
            label={row.label}
            value={row.value}
            labelColor={labelColor}
            valueColor={tooltipText}
          />
        ))}
      </div>

      {teamAllowedRows.length > 0 ? (
        <>
          <SectionTitle
            title={teamName ? `Team · ${teamName}` : 'Team Allowed'}
            labelColor={muted}
            borderColor={tooltipBorder}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {teamAllowedRows.map((row) => (
              <RankedRow
                key={row.label}
                label={row.label}
                value={row.value}
                rank={row.rank}
                labelColor={labelColor}
                valueColor={tooltipText}
                isDark={isDark}
              />
            ))}
          </div>
        </>
      ) : null}

      {ranks.length > 0 ? (
        <>
          <SectionTitle title={rankingsTitle} labelColor={muted} borderColor={tooltipBorder} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ranks.map((row) => (
              <RankedRow
                key={row.key}
                label={row.label.replace(/\s+DVP$/i, '').replace(/\s+Allowed$/i, '').trim()}
                value={row.allowed?.trim() || null}
                rank={row.rank}
                labelColor={labelColor}
                valueColor={tooltipText}
                isDark={isDark}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function renderUpcomingBarShape(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  isDark: boolean;
  barIndex: number;
  hoverPad?: number;
}): JSX.Element {
  const { x, width, isDark, barIndex } = opts;
  const HOVER_H = opts.hoverPad ?? 400;
  const rawHeight = Number(opts.height) || 0;
  const rectHeight = Math.max(36, Math.abs(rawHeight));
  const rectY =
    rawHeight < 0
      ? (Number(opts.y) || 0) + rawHeight - (rectHeight - Math.abs(rawHeight))
      : (Number(opts.y) || 0) - (rectHeight - Math.abs(rawHeight));
  const cap = Math.min(11, Math.max(3, Math.round(rectHeight / 2.4)));
  const stroke = isDark ? 'rgba(186, 230, 253, 0.92)' : 'rgba(14, 116, 144, 0.9)';
  const fillTop = isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(14, 165, 233, 0.14)';
  const fillBot = isDark ? 'rgba(56, 189, 248, 0.03)' : 'rgba(14, 165, 233, 0.03)';
  const glow = isDark ? 'rgba(56, 189, 248, 0.28)' : 'rgba(14, 165, 233, 0.22)';
  const uid = `upcoming-bar-${barIndex}`;
  const hoverY = rectY - HOVER_H;

  return (
    <g style={{ pointerEvents: 'all' }}>
      <rect
        x={x}
        y={hoverY}
        width={width}
        height={HOVER_H}
        fill="transparent"
        style={{ pointerEvents: 'all' }}
      />
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillTop} />
          <stop offset="100%" stopColor={fillBot} />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-40%" y="-20%" width="180%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.4" floodColor={glow} floodOpacity="0.9" />
        </filter>
        <pattern
          id={`${uid}-hatch`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(28)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke={isDark ? 'rgba(186,230,253,0.28)' : 'rgba(14,116,144,0.22)'}
            strokeWidth="1.5"
          />
        </pattern>
      </defs>

      <rect
        x={x - 1}
        y={rectY - 1}
        width={width + 2}
        height={rectHeight + 2}
        fill="transparent"
        stroke={glow}
        strokeWidth={1}
        rx={cap + 1}
        ry={cap + 1}
        opacity={0.55}
        filter={`url(#${uid}-glow)`}
      />

      <rect
        x={x}
        y={rectY}
        width={width}
        height={rectHeight}
        fill={`url(#${uid}-fill)`}
        rx={cap}
        ry={cap}
        data-bar-index={barIndex}
        data-upcoming="1"
      />

      <rect
        x={x}
        y={rectY}
        width={width}
        height={rectHeight}
        fill={`url(#${uid}-hatch)`}
        rx={cap}
        ry={cap}
        style={{ pointerEvents: 'none' }}
      />

      <rect
        x={x}
        y={rectY}
        width={width}
        height={rectHeight}
        fill="transparent"
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray="5 4"
        rx={cap}
        ry={cap}
        style={{ pointerEvents: 'none' }}
      />

      {/* Centered TBD badge so the ghost bar reads as upcoming, not a missing/zero bar. */}
      <rect
        x={x + Math.max(2, (width - Math.min(width - 4, 42)) / 2)}
        y={rectY + rectHeight / 2 - 9}
        width={Math.min(width - 4, 42)}
        height={18}
        rx={5}
        ry={5}
        fill={isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)'}
        stroke={stroke}
        strokeWidth={1}
        style={{ pointerEvents: 'none' }}
      />
      <text
        x={x + width / 2}
        y={rectY + rectHeight / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={isDark ? '#e0f2fe' : '#0e7490'}
        fontSize={9}
        fontWeight={800}
        letterSpacing="0.06em"
        style={{ pointerEvents: 'none' }}
      >
        TBD
      </text>
    </g>
  );
}

/** Ghost bar value = tallest plotted bar so the upcoming outline matches peak height. */
export function upcomingGhostBarValue(
  values: number[],
  opts?: { isMoneyline?: boolean; fallback?: number }
): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (opts?.isMoneyline) return 1;
  if (!finite.length) return opts?.fallback ?? 20;
  const peak = Math.max(...finite.map((v) => Math.abs(v)));
  return peak > 0 ? peak : opts?.fallback ?? 20;
}
