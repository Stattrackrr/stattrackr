'use client';

import type { EvaluatedBadge } from '@/lib/badges/evaluate';
import { BadgeArtwork } from './BadgeIcons';

type Props = {
  badges: EvaluatedBadge[];
  /** Equipped badge ids (max 2), in display order. */
  selectedIds: string[];
  loading?: boolean;
  className?: string;
};

/**
 * Name-row badges — only the equipped selection (max 2).
 */
export function BadgeStrip({ badges, selectedIds, loading, className = '' }: Props) {
  if (loading) {
    return (
      <div className={`inline-flex items-center gap-[3px] ${className}`} aria-hidden>
        {[0, 1].map((i) => (
          <span key={i} className="h-[18px] w-[18px] rounded-sm bg-gray-200 dark:bg-gray-700 animate-pulse" />
        ))}
      </div>
    );
  }

  const byId = new Map(badges.map((b) => [b.id, b]));
  const visible = selectedIds.map((id) => byId.get(id)).filter((b): b is EvaluatedBadge => Boolean(b?.earned));
  if (!visible.length) return null;

  return (
    <div className={`inline-flex items-center gap-[3px] ${className}`} role="list" aria-label="Badges">
      {visible.map((b) => (
        <span
          key={b.id}
          role="listitem"
          title={`${b.title} — ${b.description}`}
          className="inline-flex h-[18px] w-[18px] items-center justify-center"
        >
          <BadgeArtwork id={b.id} className="h-[18px] w-[18px]" />
        </span>
      ))}
    </div>
  );
}
