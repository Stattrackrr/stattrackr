'use client';

import { useState } from 'react';
import type { EvaluatedBadge } from '@/lib/badges/evaluate';
import { BadgeArtwork } from './BadgeIcons';

type Props = {
  badges: EvaluatedBadge[];
  /** Equipped ids — ringed like the profile picker selection. */
  selectedIds?: string[];
  className?: string;
};

/**
 * Read-only badge inventory matching the profile picker look:
 * unlocked colored badges, then shadowed locked silhouettes.
 */
export function BadgeInventory({ badges, selectedIds = [], className = '' }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const selected = new Set(selectedIds);
  const earned = badges.filter((b) => b.earned && !b.comingSoon);
  const locked = badges.filter((b) => !b.earned || b.comingSoon);
  const hovered =
    hoveredId != null
      ? badges.find((b) => b.id === hoveredId) ?? null
      : null;

  if (badges.length === 0) return null;

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-medium text-slate-400">Badges</p>
      {earned.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {earned.map((b) => {
            const isOn = selected.has(b.id);
            return (
              <span
                key={b.id}
                aria-label={b.title}
                onMouseEnter={() => setHoveredId(b.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  isOn
                    ? 'ring-2 ring-white/80 ring-offset-1 ring-offset-[#0d1726]'
                    : ''
                }`}
              >
                <BadgeArtwork id={b.id} className="h-7 w-7" />
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No badges unlocked yet.</p>
      )}

      {locked.length > 0 ? (
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium text-slate-400">Keep using StatTrackr to achieve</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {locked.map((b) => (
              <span
                key={b.id}
                aria-hidden
                onMouseEnter={() => setHoveredId(b.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="relative inline-flex h-7 w-7 shrink-0 pointer-events-auto text-black"
              >
                <BadgeArtwork id={b.id} silhouette className="h-7 w-7" />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-2 h-5 overflow-hidden">
        {hovered ? (
          <p className="truncate text-sm text-slate-300">
            <span className="font-medium text-white">{hovered.title}</span>
            <span className="text-slate-400"> {hovered.description}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
