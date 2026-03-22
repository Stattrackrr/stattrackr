'use client';

import { useState, useEffect } from 'react';

type Size = 'md' | 'sm';

export function AflPropsPlayerAvatar({
  headshotUrl,
  jerseyNumber,
  initials,
  isDark,
  mounted,
  size = 'md',
}: {
  headshotUrl: string | null;
  jerseyNumber: number | null;
  initials: string;
  isDark: boolean;
  mounted: boolean;
  size?: Size;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [headshotUrl]);
  const showPhoto = Boolean(headshotUrl) && !imgFailed;
  const dim = size === 'md' ? 'w-12 h-12 text-sm' : 'w-10 h-10 text-xs';
  const borderColor = mounted && isDark ? '#4b5563' : '#e5e7eb';
  const textColor = mounted && isDark ? '#a78bfa' : '#9333ea';

  return (
    <div
      className={`${dim} rounded-full flex-shrink-0 border-2 overflow-hidden flex items-center justify-center select-none bg-transparent`}
      style={{ borderColor }}
      aria-hidden
    >
      {showPhoto ? (
        <img
          src={headshotUrl!}
          alt=""
          className="w-full h-full object-cover object-top"
          loading="eager"
          fetchPriority="low"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="font-semibold" style={{ color: textColor }}>
          {jerseyNumber != null ? jerseyNumber : initials}
        </span>
      )}
    </div>
  );
}
