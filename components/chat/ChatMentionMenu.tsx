'use client';

import type { ChatMentionCandidate } from '@/lib/chatMentions';
import { useEffect, useRef } from 'react';

type Props = {
  candidates: ChatMentionCandidate[];
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (candidate: ChatMentionCandidate) => void;
};

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 65%, 52%)`;
}

export function ChatMentionMenu({ candidates, activeIndex, onHoverIndex, onSelect }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-mention-index="${activeIndex}"]`);
    if (!active) return;
    active.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, candidates.length]);

  if (candidates.length === 0) {
    return (
      <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#111c2d]">
        <p className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">No members match</p>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-[#111c2d]"
      role="listbox"
      aria-label="Mention member"
    >
      <p className="border-b border-gray-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:border-gray-800 dark:text-gray-500">
        Members
      </p>
      <ul ref={listRef} className="max-h-56 overflow-y-auto py-1">
        {candidates.map((candidate, index) => {
          const active = index === activeIndex;
          const initial = candidate.label.trim().charAt(0).toUpperCase() || '?';
          return (
            <li key={candidate.userId}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                data-mention-index={index}
                onMouseEnter={() => onHoverIndex(index)}
                onMouseDown={(event) => {
                  // Prevent textarea blur before click applies.
                  event.preventDefault();
                  onSelect(candidate);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  active
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-[#162338]'
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
                  style={candidate.avatarUrl ? undefined : { backgroundColor: avatarColor(candidate.label) }}
                >
                  {candidate.avatarUrl ? (
                    <img
                      src={candidate.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    initial
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{candidate.label}</span>
                  <span
                    className={`block truncate text-xs ${active ? 'text-purple-100' : 'text-gray-500 dark:text-gray-400'}`}
                  >
                    @{candidate.handle}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
