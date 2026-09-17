'use client';

import { useState, useEffect } from 'react';
import { tennisComAvatarImgStyle } from '@/lib/tennis/headshotDisplay';

type Size = 'md' | 'sm';

function AnonymousPlayerHead({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className="h-full w-full"
      style={{ color }}
      aria-hidden
    >
      <circle cx="20" cy="14.5" r="8" fill="currentColor" />
      <path d="M6 38c0-8.5 6.3-13.5 14-13.5S34 29.5 34 38" fill="currentColor" />
    </svg>
  );
}

export function AflPropsPlayerAvatar({
  headshotUrl,
  jerseyNumber,
  isDark,
  mounted,
  size = 'md',
}: {
  headshotUrl: string | null;
  jerseyNumber: number | null;
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
  const tennisComZoom = tennisComAvatarImgStyle(headshotUrl);
  const showAnon = !showPhoto && jerseyNumber == null;
  const anonBg = mounted && isDark ? '#374151' : '#e5e7eb';
  const anonFg = mounted && isDark ? '#6b7280' : '#9ca3af';

  return (
    <div
      className={`${dim} rounded-full flex-shrink-0 border-2 overflow-hidden flex items-center justify-center select-none ${
        showPhoto ? 'bg-gray-200 dark:bg-gray-700' : showAnon ? '' : 'bg-transparent'
      }`}
      style={{ borderColor, backgroundColor: showAnon ? anonBg : undefined }}
      aria-hidden
    >
      {showPhoto ? (
        <img
          src={headshotUrl!}
          alt=""
          className={`w-full h-full object-cover ${tennisComZoom ? '' : 'object-top'}`}
          style={tennisComZoom}
          loading="eager"
          fetchPriority="auto"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
        />
      ) : jerseyNumber != null ? (
        <span className="font-semibold" style={{ color: textColor }}>
          {jerseyNumber}
        </span>
      ) : (
        <AnonymousPlayerHead color={anonFg} />
      )}
    </div>
  );
}
