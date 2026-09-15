'use client';

import { useId } from 'react';

function TennisBallMark({
  gradientId,
  compact = false,
}: {
  gradientId: string;
  compact?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 76 76"
      className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_3px_6px_rgba(59,7,100,0.35)] ${
        compact ? 'h-8 w-8' : 'h-[38px] w-[38px]'
      }`}
      style={{ left: 'max(90px, 18.75%)' }}
      aria-hidden
    >
      <defs>
        <radialGradient id={gradientId} cx="35%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#f7ff6a" />
          <stop offset="55%" stopColor="#d4e200" />
          <stop offset="100%" stopColor="#9fb000" />
        </radialGradient>
      </defs>
      <circle cx="38" cy="38" r="36" fill={`url(#${gradientId})`} />
      <path
        d="M14 18c16 9 25 25 20 47"
        fill="none"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.92"
      />
      <path
        d="M62 16c-14 11-20 27-14 49"
        fill="none"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.92"
      />
      <ellipse cx="26" cy="24" rx="11" ry="7" fill="white" opacity="0.22" />
    </svg>
  );
}

/** ITF court: 78×36 ft doubles, 27 ft singles, net at 39 ft, service line 21 ft from net. */
function TennisCourtLines() {
  const length = 78;
  const doublesWidth = 36;
  const alley = 4.5;
  const netX = 39;
  const serviceFromNet = 21;
  const singlesTop = alley;
  const singlesBot = doublesWidth - alley;
  const centreY = doublesWidth / 2;
  const leftServiceX = netX - serviceFromNet;
  const rightServiceX = netX + serviceFromNet;
  const centreMark = 1.25;

  return (
    <g
      fill="none"
      stroke="white"
      strokeLinecap="square"
      strokeLinejoin="miter"
      transform="translate(250 60) rotate(-14) scale(5.25) translate(-39 -18)"
    >
      <rect x={0} y={0} width={length} height={doublesWidth} strokeWidth={0.42} strokeOpacity={0.92} />
      <line x1={0} y1={singlesTop} x2={length} y2={singlesTop} strokeWidth={0.38} strokeOpacity={0.86} />
      <line x1={0} y1={singlesBot} x2={length} y2={singlesBot} strokeWidth={0.38} strokeOpacity={0.86} />
      <line x1={leftServiceX} y1={singlesTop} x2={leftServiceX} y2={singlesBot} strokeWidth={0.38} strokeOpacity={0.86} />
      <line x1={rightServiceX} y1={singlesTop} x2={rightServiceX} y2={singlesBot} strokeWidth={0.38} strokeOpacity={0.86} />
      <line x1={leftServiceX} y1={centreY} x2={rightServiceX} y2={centreY} strokeWidth={0.38} strokeOpacity={0.86} />
      <line x1={netX} y1={-3} x2={netX} y2={doublesWidth + 3} strokeWidth={0.72} strokeOpacity={0.96} />
      <line x1={0} y1={centreY} x2={centreMark} y2={centreY} strokeWidth={0.38} strokeOpacity={0.86} />
      <line x1={length - centreMark} y1={centreY} x2={length} y2={centreY} strokeWidth={0.38} strokeOpacity={0.86} />
    </g>
  );
}

/** Decorative tennis graphic for the empty desktop Filter By slot. */
export function TennisBannerArt({
  className = '',
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const vignetteId = `tb-vignette-${uid}`;
  const ballId = `tb-ball-${uid}`;

  return (
    <div
      className={`relative h-[120px] flex-shrink-0 overflow-hidden rounded-lg bg-[#7c3aed] shadow-[0_8px_24px_rgba(124,58,237,0.35)] ${className}`}
      aria-hidden
    >
      <div className="h-full w-full">
        <svg
          viewBox="0 0 480 120"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMinYMid slice"
        >
          <defs>
            <radialGradient id={vignetteId} cx="50%" cy="50%" r="75%">
              <stop offset="40%" stopColor="#7c3aed" stopOpacity="0" />
              <stop offset="100%" stopColor="#5b21b6" stopOpacity="0.45" />
            </radialGradient>
          </defs>

          <rect width="480" height="120" fill="#7c3aed" />
          <TennisCourtLines />
          <rect width="480" height="120" fill={`url(#${vignetteId})`} />
        </svg>

        <TennisBallMark gradientId={ballId} compact={compact} />

        <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col items-end justify-center pr-5">
          <span className="text-[11px] font-semibold tracking-[0.42em] text-white/70">STATTRACKR</span>
          <span className="mt-0.5 text-[28px] font-black leading-none tracking-[0.18em] text-white">
            TENNIS
          </span>
        </div>
      </div>
    </div>
  );
}
