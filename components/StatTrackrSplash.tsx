"use client";

import { StatTrackrLogo } from "@/components/StatTrackrLogo";

/**
 * Shared boot / loading screen — dark shell with a soft logo breathe + fade-in.
 */
export function StatTrackrSplash({
  className = "",
}: {
  className?: string;
} = {}) {
  return (
    <div
      className={`min-h-screen bg-[#050d1a] flex items-center justify-center overflow-hidden ${className}`}
      role="status"
      aria-live="polite"
      aria-label="Loading StatTrackr"
    >
      <div className="relative flex flex-col items-center gap-4 st-splash-enter">
        {/* Soft brand glow behind the mark */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[38%] h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-500/25 blur-3xl st-splash-glow"
        />

        <div className="relative st-splash-breathe">
          <StatTrackrLogo className="w-20 h-20" />
        </div>

        <span className="relative font-bold text-4xl text-white tracking-tight st-splash-title">
          StatTrackr
        </span>

        {/* Subtle progress dots */}
        <div className="relative mt-1 flex items-center gap-1.5" aria-hidden>
          <span className="st-splash-dot" />
          <span className="st-splash-dot st-splash-dot-delay-1" />
          <span className="st-splash-dot st-splash-dot-delay-2" />
        </div>
      </div>
    </div>
  );
}
