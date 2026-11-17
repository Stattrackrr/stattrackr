/**
 * Loading shell for AI picks — matches RecordStrip + tabs + PickCard layout.
 */

function bone(className: string) {
  return `animate-pulse rounded bg-gray-200 dark:bg-white/10 ${className}`;
}

function PickCardSkeleton() {
  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-white/[0.07] dark:bg-[#0f1a2b]"
      aria-hidden
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-gray-200 dark:bg-white/10" aria-hidden />
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className={bone('h-6 w-6 !rounded-full')} />
          <div className={bone('h-3.5 w-24')} />
          <div className={bone('h-3 w-16')} />
        </div>
        <div className={bone('h-6 w-16 !rounded-full')} />
      </div>
      <div className="px-4 pb-3 pt-3">
        <div className={bone('mb-2 h-3 w-28')} />
        <div className={bone('h-5 w-56')} />
        <div className={bone('mt-2 h-4 w-40')} />
      </div>
      <div className="mx-4 mb-4 grid grid-cols-3 divide-x divide-gray-200/80 rounded-xl bg-gray-50 dark:divide-white/[0.07] dark:bg-white/[0.03]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="px-3 py-2.5 text-center">
            <div className={bone('mx-auto h-2.5 w-12')} />
            <div className={bone('mx-auto mt-1.5 h-4 w-10')} />
          </div>
        ))}
      </div>
    </article>
  );
}

export function AiPicksFeedSkeleton({ cardCount = 4 }: { cardCount?: number }) {
  return (
    <div className="flex min-h-full flex-col gap-3" aria-busy="true" aria-label="Loading AI picks">
      <div className="-mx-5 -mt-4 space-y-3 bg-white/95 px-5 pb-3 pt-4 backdrop-blur dark:bg-[#0f1a2b]/95 sm:sticky sm:-top-4">
        <div className="grid grid-cols-4 divide-x divide-gray-200/80 rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:divide-white/[0.07] dark:border-white/[0.07] dark:bg-[#0f1a2b]">
          {['Units', 'ROI', 'Record', 'Pending'].map((label) => (
            <div key={label} className="min-w-0 px-1.5 py-2.5 text-center sm:px-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {label}
              </div>
              <div className={bone('mx-auto mt-1 h-5 w-12')} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.04]">
          {['Pending', 'Resulted'].map((label, i) => (
            <div
              key={label}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold ${
                i === 0
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-[#1a2740] dark:text-white'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {label}
              <span className={bone('h-4 w-5 !rounded-full')} />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className={bone('h-7 w-20 !rounded-full')} />
            ))}
          </div>
          <div className={bone('h-7 w-24 !rounded-full')} />
        </div>
      </div>

      {Array.from({ length: cardCount }, (_, i) => (
        <PickCardSkeleton key={i} />
      ))}
    </div>
  );
}
