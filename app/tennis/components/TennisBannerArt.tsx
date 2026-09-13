/** Decorative tennis graphic for the empty desktop Filter By slot. */
export function TennisBannerArt({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative h-[120px] flex-shrink-0 overflow-hidden rounded-lg bg-[#7c3aed] shadow-[0_8px_24px_rgba(124,58,237,0.35)] ${className}`}
      aria-hidden
    >
      <div className="h-full w-full">
        <svg
          viewBox="0 0 480 120"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <radialGradient id="tb-vignette" cx="50%" cy="50%" r="75%">
              <stop offset="40%" stopColor="#7c3aed" stopOpacity="0" />
              <stop offset="100%" stopColor="#5b21b6" stopOpacity="0.45" />
            </radialGradient>
            <radialGradient id="tb-ball" cx="35%" cy="32%" r="70%">
              <stop offset="0%" stopColor="#f7ff6a" />
              <stop offset="55%" stopColor="#d4e200" />
              <stop offset="100%" stopColor="#9fb000" />
            </radialGradient>
            <filter id="tb-soft" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#3b0764" floodOpacity="0.35" />
            </filter>
          </defs>

          <rect width="480" height="120" fill="#7c3aed" />

          <g
            transform="translate(248 62) rotate(-18) translate(-210 -96)"
            fill="none"
            stroke="white"
            strokeLinecap="square"
          >
            <rect x="8" y="8" width="404" height="176" rx="2" strokeOpacity="0.28" strokeWidth="2.4" />
            <rect x="36" y="8" width="348" height="176" strokeOpacity="0.22" strokeWidth="1.6" />
            <line x1="210" y1="8" x2="210" y2="184" strokeOpacity="0.55" strokeWidth="2.2" />
            <line x1="36" y1="96" x2="384" y2="96" strokeOpacity="0.2" strokeWidth="1.4" />
            <line x1="118" y1="8" x2="118" y2="184" strokeOpacity="0.18" strokeWidth="1.4" />
            <line x1="302" y1="8" x2="302" y2="184" strokeOpacity="0.18" strokeWidth="1.4" />
            <line x1="118" y1="52" x2="302" y2="52" strokeOpacity="0.32" strokeWidth="1.6" />
            <line x1="118" y1="140" x2="302" y2="140" strokeOpacity="0.32" strokeWidth="1.6" />
            <line x1="210" y1="52" x2="210" y2="140" strokeOpacity="0.38" strokeWidth="1.6" />
            {Array.from({ length: 15 }).map((_, i) => (
              <line
                key={i}
                x1="204"
                y1={14 + i * 11.4}
                x2="216"
                y2={14 + i * 11.4}
                strokeOpacity="0.42"
                strokeWidth="1.1"
              />
            ))}
          </g>

          <rect width="480" height="120" fill="url(#tb-vignette)" />

          <g filter="url(#tb-soft)">
            <circle cx="78" cy="62" r="38" fill="url(#tb-ball)" />
            <path
              d="M52 40c18 10 28 28 22 52"
              fill="none"
              stroke="white"
              strokeWidth="3.2"
              strokeLinecap="round"
              opacity="0.92"
            />
            <path
              d="M104 38c-16 12-22 30-16 54"
              fill="none"
              stroke="white"
              strokeWidth="3.2"
              strokeLinecap="round"
              opacity="0.92"
            />
            <ellipse cx="64" cy="48" rx="12" ry="7" fill="white" opacity="0.22" />
          </g>
        </svg>

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
