'use client';

import { splitMentionSegments } from '@/lib/chatMentions';
import { memo } from 'react';

type Props = {
  value: string;
  knownHandles: Set<string>;
  /** Match the input padding / typography so chips line up with the caret. */
  className?: string;
};

/**
 * Discord-style mention chips drawn under a transparent composer input.
 */
export const ChatComposerHighlight = memo(function ChatComposerHighlight({
  value,
  knownHandles,
  className = '',
}: Props) {
  if (!value) return null;

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-sm leading-5 text-gray-900 dark:text-white ${className}`}
    >
      {splitMentionSegments(value, knownHandles).map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={`t-${index}`}>{segment.value}</span>;
        }
        return (
          <span
            key={`m-${index}-${segment.value}`}
            className="rounded-[3px] bg-[#5865F2]/20 px-0.5 font-medium text-[#3C45A5] dark:bg-[#5865F2]/40 dark:text-[#DEE0FC]"
          >
            @{segment.value}
          </span>
        );
      })}
    </div>
  );
});
