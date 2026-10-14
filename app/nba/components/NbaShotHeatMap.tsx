'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { NBA_COURT } from '@/lib/nba/dash/shotZonesShared';

/** [across ft, depth ft from baseline, made 1/0, three 1/0] from the shot-chart API. */
export type NbaHeatPoint = [number, number, 0 | 1, 0 | 1];

const VIEW_W = 500;
const VIEW_H = 380;
/** Pixels per foot — the full 50 ft court width fills the view. */
const S = VIEW_W / NBA_COURT.widthFt;
const BASELINE_Y = VIEW_H;
const RIM_X = VIEW_W / 2;
const RIM_Y = BASELINE_Y - NBA_COURT.rimFromBaselineFt * S;

/** NBA markings (feet). */
const KEY_HALF_W = 8;
const KEY_DEPTH = 19;
const FT_CIRCLE_R = 6;
const RESTRICTED_R = 4;
const THREE_R = 23.75;
const THREE_CORNER_FROM_SIDELINE = 3;
const BACKBOARD_FROM_BASELINE = 4;
const BACKBOARD_HALF_W = 3;
const RIM_R = 0.75;

const GRID_W = 125;
const GRID_H = 95;
const CELL = VIEW_W / GRID_W;
/** Kernel spread (feet) — wide enough that a season of shots reads as smooth regions. */
const SIGMA_FT = 3.6;
/** Above 1 keeps low-volume areas dark so only real hot spots glow. */
const GAMMA = 1.15;

/** Inferno colour ramp (black → purple → orange → pale yellow). */
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [0, 0, 4]],
  [0.12, [27, 12, 65]],
  [0.25, [74, 12, 107]],
  [0.38, [120, 28, 109]],
  [0.5, [165, 44, 96]],
  [0.62, [207, 68, 70]],
  [0.74, [237, 105, 37]],
  [0.86, [251, 155, 6]],
  [0.94, [247, 209, 61]],
  [1, [252, 255, 164]],
];
const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`).join(', ')})`;

function rampColor(t: number): [number, number, number] {
  for (let i = 1; i < RAMP.length; i += 1) {
    const [t1, c1] = RAMP[i]!;
    const [t0, c0] = RAMP[i - 1]!;
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1);
      return [0, 1, 2].map((j) => Math.round(c0[j]! + (c1[j]! - c0[j]!) * k)) as [number, number, number];
    }
  }
  return RAMP[RAMP.length - 1]![1];
}

function toView(point: NbaHeatPoint): { x: number; y: number } {
  return { x: point[0] * S, y: BASELINE_Y - point[1] * S };
}

function densityImage(points: NbaHeatPoint[]): string | null {
  if (typeof document === 'undefined' || points.length === 0) return null;
  const grid = new Float32Array(GRID_W * GRID_H);
  const sigmaPx = SIGMA_FT * S;
  const reach = Math.ceil((sigmaPx * 3) / CELL);
  const twoSigma2 = 2 * sigmaPx * sigmaPx;
  for (const point of points) {
    const { x, y } = toView(point);
    if (y < -sigmaPx * 3) continue;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let gy = Math.max(0, cy - reach); gy <= Math.min(GRID_H - 1, cy + reach); gy += 1) {
      const dy = (gy + 0.5) * CELL - y;
      for (let gx = Math.max(0, cx - reach); gx <= Math.min(GRID_W - 1, cx + reach); gx += 1) {
        const dx = (gx + 0.5) * CELL - x;
        grid[gy * GRID_W + gx] += Math.exp(-(dx * dx + dy * dy) / twoSigma2);
      }
    }
  }
  let max = 0;
  for (const v of grid) if (v > max) max = v;
  if (max <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(GRID_W, GRID_H);
  for (let i = 0; i < grid.length; i += 1) {
    const [r, g, b] = rampColor(Math.pow(grid[i]! / max, GAMMA));
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function CourtLines({ stroke }: { stroke: string }) {
  const keyLeft = RIM_X - KEY_HALF_W * S;
  const keyRight = RIM_X + KEY_HALF_W * S;
  const keyTop = BASELINE_Y - KEY_DEPTH * S;
  const ftR = FT_CIRCLE_R * S;
  const cornerX = THREE_CORNER_FROM_SIDELINE * S;
  const cornerDy = Math.sqrt(THREE_R ** 2 - (NBA_COURT.widthFt / 2 - THREE_CORNER_FROM_SIDELINE) ** 2) * S;
  const cornerTopY = RIM_Y - cornerDy;
  const threeR = THREE_R * S;
  const restrictedR = RESTRICTED_R * S;
  const backboardY = BASELINE_Y - BACKBOARD_FROM_BASELINE * S;
  return (
    <g fill="none" stroke={stroke} strokeWidth={1.5}>
      <rect x={0.75} y={0.75} width={VIEW_W - 1.5} height={VIEW_H - 1.5} />
      <path d={`M ${keyLeft} ${BASELINE_Y} L ${keyLeft} ${keyTop} L ${keyRight} ${keyTop} L ${keyRight} ${BASELINE_Y}`} />
      <path d={`M ${RIM_X - ftR} ${keyTop} A ${ftR} ${ftR} 0 0 1 ${RIM_X + ftR} ${keyTop}`} />
      <path d={`M ${RIM_X - ftR} ${keyTop} A ${ftR} ${ftR} 0 0 0 ${RIM_X + ftR} ${keyTop}`} strokeDasharray="6 5" />
      <path
        d={`M ${cornerX} ${BASELINE_Y} L ${cornerX} ${cornerTopY} A ${threeR} ${threeR} 0 0 1 ${VIEW_W - cornerX} ${cornerTopY} L ${VIEW_W - cornerX} ${BASELINE_Y}`}
      />
      <path
        d={`M ${RIM_X - restrictedR} ${backboardY} L ${RIM_X - restrictedR} ${RIM_Y} A ${restrictedR} ${restrictedR} 0 0 1 ${RIM_X + restrictedR} ${RIM_Y} L ${RIM_X + restrictedR} ${backboardY}`}
      />
      <line x1={RIM_X - BACKBOARD_HALF_W * S} y1={backboardY} x2={RIM_X + BACKBOARD_HALF_W * S} y2={backboardY} strokeWidth={2} />
      <circle cx={RIM_X} cy={RIM_Y} r={RIM_R * S} />
    </g>
  );
}

function HeatCourt({ image, locked, clipId }: { image: string | null; locked: boolean; clipId: string }) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full"
      style={{ height: 'auto', width: '100%' }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id={`${clipId}-heat`}>
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="10" ry="10" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId}-heat)`}>
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#000004" />
        {image ? <image href={image} x="0" y="0" width={VIEW_W} height={VIEW_H} preserveAspectRatio="none" /> : null}
        <CourtLines stroke="rgba(190,190,200,0.55)" />
        {locked ? (
          <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" fill="#fff" fontSize={32} fontWeight="bold" stroke="#000" strokeWidth={0.5}>
            TBD
          </text>
        ) : null}
      </g>
    </svg>
  );
}

export function NbaShotHeatMap({
  points,
  isDark,
  locked = false,
  clipId,
  label = 'Shot frequency',
  countLabel = 'shots',
}: {
  points: NbaHeatPoint[];
  isDark: boolean;
  locked?: boolean;
  clipId: string;
  label?: string;
  countLabel?: string;
}) {
  const [image, setImage] = useState<string | null>(null);
  const visible = useMemo(() => (locked ? [] : points), [points, locked]);

  useEffect(() => {
    setImage(densityImage(visible));
  }, [visible]);

  return (
    <div className="w-full">
      <HeatCourt image={image} locked={locked} clipId={clipId} />
      <div className="mt-2 flex items-center gap-2 text-sm font-medium flex-wrap justify-center">
        <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{label}</span>
        <div className="flex flex-col items-stretch">
          <div className="h-3 w-32 rounded-sm" style={{ background: RAMP_CSS }} />
          <div className="flex justify-between text-[10px] leading-tight text-gray-500 dark:text-gray-400">
            <span>lower</span>
            <span>higher</span>
          </div>
        </div>
        {!locked && visible.length > 0 ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">{visible.length} {countLabel}</span>
        ) : null}
      </div>
    </div>
  );
}
