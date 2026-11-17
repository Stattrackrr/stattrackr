/**
 * Suspense fallback for /journal — matches sidebar + main board chrome, not a centered text dump.
 */

function bone(className: string) {
  return `animate-pulse rounded bg-white/10 ${className}`;
}

export function JournalPageSkeleton() {
  return (
    <div className="min-h-screen bg-[#050d1a] text-white" aria-busy="true" aria-label="Loading journal">
      <div className="hidden lg:block fixed left-0 top-0 h-full w-[340px] border-r border-white/10 bg-[#050d1a] p-4">
        <div className={bone('mb-6 h-8 w-36')} />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={bone('h-9 w-full')} />
          ))}
        </div>
      </div>
      <div className="lg:ml-[340px] px-3 pt-4 pb-24">
        <div className="mx-auto max-w-[1550px] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={bone('h-8 w-40')} />
            <div className="flex gap-2">
              <div className={bone('h-8 w-24')} />
              <div className={bone('h-8 w-24')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-[#0a1524] p-4">
                <div className={bone('h-3 w-16')} />
                <div className={bone('mt-2 h-6 w-20')} />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0a1524] overflow-hidden">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-b-0"
              >
                <div className={bone('h-8 w-8 !rounded-full')} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className={bone('h-4 w-48')} />
                  <div className={bone('h-3 w-28')} />
                </div>
                <div className={bone('h-5 w-14')} />
                <div className={bone('h-5 w-12')} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
