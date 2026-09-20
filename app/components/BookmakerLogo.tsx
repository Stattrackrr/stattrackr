'use client';

import { useMemo, useState } from 'react';
import { getBookmakerInfo } from '@/lib/bookmakers';

export default function BookmakerLogo({
  bookKey,
  className = 'w-5 h-5 rounded object-contain flex-shrink-0',
  alt,
}: {
  bookKey: string;
  className?: string;
  alt?: string;
}) {
  const info = useMemo(() => getBookmakerInfo(bookKey), [bookKey]);
  const sources = info.logoUrls?.length ? info.logoUrls : info.logoUrl ? [info.logoUrl] : [];
  const [index, setIndex] = useState(0);
  const src = sources[index];

  if (!src || index >= sources.length) {
    return (
      <span
        className={`${className} flex items-center justify-center text-[10px] font-semibold text-white`}
        style={{ backgroundColor: info.color }}
        title={info.name}
        aria-label={alt ?? info.name}
      >
        {info.logo}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? info.name}
      title={info.name}
      className={className}
      onError={() => setIndex((prev) => prev + 1)}
    />
  );
}
