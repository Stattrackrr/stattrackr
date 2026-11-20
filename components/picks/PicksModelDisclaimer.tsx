'use client';

import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

/** Stand-in model notice shown above the picks feed. */
export function PicksModelDisclaimer() {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className="mb-4 rounded-2xl border border-amber-400/50 bg-amber-50 px-3.5 py-3 dark:border-amber-400/35 dark:bg-amber-500/10 sm:px-4 sm:py-3.5"
      role="note"
    >
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
          <TriangleAlert className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-800 dark:text-amber-200">
            Not a model you should trust yet
          </p>
          <h3 className="mt-1 text-sm font-semibold text-amber-950 dark:text-amber-50 sm:text-[15px]">
            This is a temporary stand-in while better models collect data
          </h3>
          <p
            className={`mt-1.5 text-sm leading-relaxed text-amber-950/80 dark:text-amber-50/80 ${
              expanded ? '' : 'line-clamp-3 sm:line-clamp-none'
            }`}
          >
            We have stronger models gathering results every day. Once they have enough of a sample, they will replace
            what you see here, and they should be much better. These picks are only here in the meantime so there is
            something live on the page. Do not treat them as a finished product, and do not size bets like this is the
            real model.
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 text-sm font-semibold text-amber-800 underline-offset-2 hover:underline dark:text-amber-200 sm:hidden"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      </div>
    </aside>
  );
}
