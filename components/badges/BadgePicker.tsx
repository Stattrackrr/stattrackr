'use client';

import { useState } from 'react';
import type { EvaluatedBadge } from '@/lib/badges/evaluate';
import { MAX_DISPLAYED_BADGES } from '@/lib/badges/catalog';
import { BadgeArtwork } from './BadgeIcons';

type Props = {
  badges: EvaluatedBadge[];
  selectedIds: string[];
  loading?: boolean;
  saving?: boolean;
  onChange: (nextIds: string[]) => void;
};

/**
 * Compact badge inventory — earned on top, locked silhouettes below.
 * Tip area keeps a fixed height so hover never reflows the modal.
 */
export function BadgePicker({ badges, selectedIds, loading, saving, onChange }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [capShake, setCapShake] = useState(false);

  const bumpCap = () => {
    setCapShake(false);
    requestAnimationFrame(() => setCapShake(true));
    window.setTimeout(() => setCapShake(false), 480);
  };

  if (loading) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Badges</p>
          <p className="text-xs tabular-nums text-gray-400 dark:text-gray-500">0/{MAX_DISPLAYED_BADGES}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-7 w-7 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
          ))}
        </div>
        <div className="mt-2 h-5" aria-hidden />
      </div>
    );
  }

  const selected = new Set(selectedIds);
  const atCap = selectedIds.length >= MAX_DISPLAYED_BADGES;
  const earned = badges.filter((b) => b.earned && !b.comingSoon);
  const locked = badges.filter((b) => !b.earned || b.comingSoon);
  const hovered = hoveredId ? earned.find((b) => b.id === hoveredId) ?? null : null;

  const toggle = (b: EvaluatedBadge) => {
    if (!b.earned || b.comingSoon || saving) return;
    if (selected.has(b.id)) {
      onChange(selectedIds.filter((id) => id !== b.id));
      return;
    }
    if (atCap) {
      bumpCap();
      return;
    }
    onChange([...selectedIds, b.id]);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Badges</p>
        <p
          className={`text-xs tabular-nums ${
            capShake ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'
          }`}
          style={capShake ? { animation: 'st-badge-cap-shake 0.45s ease-in-out' } : undefined}
        >
          {selectedIds.length}/{MAX_DISPLAYED_BADGES} shown
        </p>
      </div>
      <style>{`
        @keyframes st-badge-cap-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-3px); }
          40% { transform: translateX(3px); }
          60% { transform: translateX(-2px); }
          80% { transform: translateX(2px); }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-1.5">
        {earned.map((b) => {
          const isOn = selected.has(b.id);
          return (
            <button
              key={b.id}
              type="button"
              disabled={saving}
              aria-pressed={isOn}
              aria-label={b.title}
              onClick={() => toggle(b)}
              onMouseEnter={() => setHoveredId(b.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`relative h-7 w-7 shrink-0 rounded-full transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400 dark:focus-visible:ring-offset-slate-900 hover:opacity-90 ${
                isOn
                  ? 'ring-2 ring-gray-900/80 dark:ring-white/80 ring-offset-1 ring-offset-white dark:ring-offset-slate-900'
                  : ''
              }`}
            >
              <BadgeArtwork id={b.id} className="h-7 w-7" />
            </button>
          );
        })}
      </div>

      {locked.length > 0 ? (
        <div className="mt-6">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            Keep using StatTrackr to achieve
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {locked.map((b) => (
              <span
                key={b.id}
                aria-hidden
                className="relative h-7 w-7 shrink-0 text-black dark:text-black pointer-events-none"
              >
                <BadgeArtwork id={b.id} silhouette className="h-7 w-7" />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Fixed height so tip show/hide never reflows the modal under the cursor */}
      <div className="mt-2 h-5 overflow-hidden">
        {hovered ? (
          <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
            <span className="font-medium text-gray-900 dark:text-white">{hovered.title}</span>
            <span className="text-gray-500 dark:text-gray-400"> {hovered.description}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
