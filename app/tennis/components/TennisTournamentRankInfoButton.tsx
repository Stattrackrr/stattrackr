'use client';

import { useEffect, useRef, useState } from 'react';

export function TennisTournamentRankInfoButton({
  isDark,
  label,
  title,
  text,
}: {
  isDark: boolean;
  label: string;
  title: string;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span ref={rootRef} className="group inline-flex shrink-0 items-center justify-center">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-[9px] font-black leading-none text-white shadow-[0_0_8px_rgba(147,51,234,0.55)] hover:bg-purple-500"
      >
        ?
      </button>
      <span
        role="tooltip"
        aria-hidden={!open}
        className={`pointer-events-none absolute z-[80] left-1.5 top-full mt-1.5 w-[min(18rem,calc(100%-0.75rem))] px-3 py-2 text-left text-[11px] font-normal leading-relaxed whitespace-pre-line rounded-lg border shadow-lg transition-opacity ${
          open ? 'opacity-100' : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'
        } ${
          isDark
            ? 'bg-[#071422] border-gray-500 text-gray-100'
            : 'bg-white border-gray-300 text-gray-900'
        }`}
      >
        <strong className="block mb-1">{title}</strong>
        {text}
      </span>
    </span>
  );
}
