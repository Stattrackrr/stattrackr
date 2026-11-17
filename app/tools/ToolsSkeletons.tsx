/**
 * Loading shells for Betting Tools — same shape as OpportunityCard / BonusFlipper results.
 */

const TOOL_TABS = ['ALL', 'ARB', 'EV', 'MID', 'BF'] as const;

function bone(isDark: boolean, className: string) {
  return `animate-pulse rounded ${isDark ? 'bg-white/10' : 'bg-gray-200'} ${className}`;
}

/** One opportunity card: chip + match header + 3 stat tiles + 2 leg rows. */
export function OpportunityCardSkeleton({ isDark }: { isDark: boolean }) {
  const card = isDark ? 'border-white/10 bg-[#0a1524]' : 'border-gray-200 bg-white';
  const tile = isDark ? 'border-white/10 bg-black/20' : 'border-gray-100 bg-gray-50';
  return (
    <article className={`rounded-xl border p-4 sm:p-5 ${card}`} aria-hidden>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className={bone(isDark, 'h-5 w-16')} />
          <div className={bone(isDark, 'h-3.5 w-10')} />
        </div>
        <div className={bone(isDark, 'h-5 w-14')} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className={bone(isDark, 'h-12 w-12 shrink-0 !rounded-full')} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className={bone(isDark, 'h-5 w-48')} />
          <div className={bone(isDark, 'h-3.5 w-32')} />
        </div>
        <div className={bone(isDark, 'h-12 w-12 shrink-0 !rounded-full')} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`rounded-lg border px-3 py-2 ${tile}`}>
            <div className={bone(isDark, 'h-2.5 w-10')} />
            <div className={bone(isDark, 'mt-1.5 h-4 w-12')} />
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-1.5">
        {[0, 1].map((i) => (
          <div key={i} className={`rounded-lg border px-3 py-2.5 ${tile}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <div className={bone(isDark, 'h-5 w-5 shrink-0')} />
                <div className={bone(isDark, 'h-4 w-36')} />
              </span>
              <div className={bone(isDark, 'h-5 w-10 shrink-0')} />
            </div>
            <div className={bone(isDark, 'mt-1.5 h-3 w-20')} />
          </div>
        ))}
      </div>
    </article>
  );
}

export function ToolsOpsSkeletonGrid({ isDark, count = 6 }: { isDark: boolean; count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3"
      aria-busy="true"
      aria-label="Loading opportunities"
    >
      {Array.from({ length: count }, (_, i) => (
        <OpportunityCardSkeleton key={i} isDark={isDark} />
      ))}
    </div>
  );
}

/** Tabs + opportunity grid — used while auth/subscription resolves and on first board fetch. */
export function ToolsBoardSkeleton({ isDark }: { isDark: boolean }) {
  const muted = isDark ? 'text-slate-400' : 'text-gray-500';
  return (
    <div className="pb-24 lg:pb-8">
      <div
        className={`mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-3 ${
          isDark ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <nav className="-mb-px flex flex-wrap gap-1" aria-hidden>
          {TOOL_TABS.map((label, i) => (
            <span
              key={label}
              className={`relative px-3 py-2 text-sm font-medium tracking-wide ${
                i === 0 ? (isDark ? 'text-white' : 'text-gray-900') : muted
              }`}
            >
              {label}
              {i === 0 ? (
                <span
                  className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${
                    isDark ? 'bg-white' : 'bg-gray-900'
                  }`}
                />
              ) : null}
            </span>
          ))}
        </nav>
        <div className={bone(isDark, 'h-7 w-16')} />
      </div>
      <ToolsOpsSkeletonGrid isDark={isDark} />
    </div>
  );
}

/** Bonus Flipper result cards (controls above stay live). */
export function BonusFlipSkeletonGrid({ isDark, count = 4 }: { isDark: boolean; count?: number }) {
  const card = isDark ? 'border-white/10 bg-[#0a1524]' : 'border-gray-200 bg-white';
  const tile = isDark ? 'border-white/10 bg-black/20' : 'border-gray-100 bg-gray-50';
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3"
      aria-busy="true"
      aria-label="Finding flips"
    >
      {Array.from({ length: count }, (_, i) => (
        <article key={i} className={`rounded-xl border p-4 sm:p-5 ${card}`} aria-hidden>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className={bone(isDark, 'h-5 w-24')} />
              <div className={bone(isDark, 'h-3.5 w-10')} />
            </div>
            <div className={bone(isDark, 'h-5 w-16')} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className={bone(isDark, 'h-12 w-12 shrink-0 !rounded-full')} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className={bone(isDark, 'h-5 w-48')} />
              <div className={bone(isDark, 'h-3.5 w-32')} />
            </div>
            <div className={bone(isDark, 'h-12 w-12 shrink-0 !rounded-full')} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((j) => (
              <div key={j} className={`rounded-lg border px-3 py-2 ${tile}`}>
                <div className={bone(isDark, 'h-2.5 w-10')} />
                <div className={bone(isDark, 'mt-1.5 h-4 w-12')} />
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-1.5">
            {[0, 1].map((j) => (
              <div key={j} className={`rounded-lg border px-3 py-2.5 ${tile}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <div className={bone(isDark, 'h-5 w-5 shrink-0')} />
                    <div className={bone(isDark, 'h-4 w-40')} />
                  </span>
                  <div className={bone(isDark, 'h-5 w-10 shrink-0')} />
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
