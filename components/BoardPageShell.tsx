'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { consumeBoardNavDir, type BoardNavDir } from '@/lib/boardNavTransition';

/**
 * Props / Tools shell. On a board switch, lifts a veil and settles content in —
 * chrome (mobile nav) stays outside so fixed UI never gets trapped by transforms.
 */
export function BoardPageShell({
  children,
  chrome,
  className = '',
}: {
  children: ReactNode;
  chrome?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dir, setDir] = useState<BoardNavDir | null>(null);

  useLayoutEffect(() => {
    const next = consumeBoardNavDir();
    if (!next) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    setDir(next);
    const el = ref.current;
    if (!el) return;
    const clear = () => setDir(null);
    const onEnd = (event: AnimationEvent) => {
      if (event.target !== el) return;
      clear();
    };
    el.addEventListener('animationend', onEnd);
    const fallback = window.setTimeout(clear, 520);
    return () => {
      el.removeEventListener('animationend', onEnd);
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <div className={`relative ${className}`.trim()}>
      {dir ? <div className="board-shell-veil" aria-hidden="true" /> : null}
      <div
        ref={ref}
        data-board-shell
        data-board-dir={dir || undefined}
        className={dir ? `board-shell-enter board-shell-enter--${dir}` : undefined}
      >
        {children}
      </div>
      {chrome}
    </div>
  );
}
