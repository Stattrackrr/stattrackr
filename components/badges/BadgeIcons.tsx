/**
 * Discord-style profile badges — small emblem SVGs.
 * `silhouette` = Cookie Clicker locked look: black filled shape, no color.
 */

'use client';

import { useId } from 'react';

type Props = { className?: string; silhouette?: boolean };

function useSafeId() {
  return useId().replace(/:/g, '');
}

export function BadgeArtwork({
  id,
  className = 'w-[18px] h-[18px]',
  silhouette = false,
  outline = false,
}: {
  id: string;
  className?: string;
  muted?: boolean;
  /** @deprecated use silhouette */
  outline?: boolean;
  silhouette?: boolean;
}) {
  const locked = silhouette || outline;
  const props: Props = { className, silhouette: locked };
  switch (id) {
    case 'admin':
      return <BadgeAdmin {...props} />;
    case 'new_user':
      return <BadgeNewUser {...props} />;
    case 'free':
      return <BadgeFree {...props} />;
    case 'pro':
      return <BadgePro {...props} />;
    case 'member_1m':
      return <BadgeTenure {...props} color="#3BA55D" />;
    case 'member_3m':
      return <BadgeTenure {...props} color="#1ABC9C" />;
    case 'member_6m':
      return <BadgeTenure {...props} color="#5865F2" />;
    case 'member_1y':
      return <BadgeTenure {...props} color="#9B59B6" />;
    case 'referred':
      return <BadgeReferred {...props} />;
    case 'connector':
      return <BadgeConnector {...props} />;
    case 'early_bird':
      return <BadgeEarlyBird {...props} />;
    case 'researcher_50':
      return <BadgeResearcher {...props} color="#00B0F4" />;
    case 'researcher_500':
      return <BadgeResearcher {...props} color="#5865F2" />;
    case 'ai_watcher':
      return <BadgeAiWatcher {...props} />;
    default:
      return <BadgeFallback {...props} />;
  }
}

/** @deprecated */
export function BadgeIcon({ id, className }: { id: string; className?: string }) {
  return <BadgeArtwork id={id} className={className} />;
}

/** @deprecated */
export function badgeDiscStyle(_id: string, _muted: boolean): { bg: string; fg: string } {
  return { bg: 'transparent', fg: '#fff' };
}

/** Cookie Clicker locked look — solid black, faint edge so it reads on dark UI. */
const SIL = '#000000';
const SIL_EDGE = 'rgba(255,255,255,0.18)';

function silProps(extra?: Record<string, string | number>) {
  return { fill: SIL, stroke: SIL_EDGE, strokeWidth: 1, strokeLinejoin: 'round' as const, ...extra };
}

function BadgeAdmin({ className, silhouette }: Props) {
  const g = useSafeId();
  // Distinct royal crown — points + jewels, separate from the Pro mark.
  const crown =
    'M3.5 17.2l1.8-9.2 3.6 4.1L12 4.8l3.1 7.3 3.6-4.1 1.8 9.2H3.5zm1.3 1.5h14.4v1.8H4.8z';
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d={crown} {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={g} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#FFE566" />
          <stop offset="45%" stopColor="#F5C518" />
          <stop offset="100%" stopColor="#B8860B" />
        </linearGradient>
      </defs>
      <path fill={`url(#${g})`} d={crown} stroke="#8B6914" strokeWidth="0.5" strokeLinejoin="round" />
      <circle cx="12" cy="8.2" r="1.15" fill="#FFF8DC" />
      <circle cx="7.2" cy="11.2" r="0.85" fill="#E8B923" />
      <circle cx="16.8" cy="11.2" r="0.85" fill="#E8B923" />
    </svg>
  );
}

function BadgeNewUser({ className, silhouette }: Props) {
  const g = useSafeId();
  const d = 'M12 2.2l2.55 5.17 5.7.83-4.12 4.02.97 5.66L12 15.2l-5.1 2.68.97-5.66L3.75 8.2l5.7-.83L12 2.2z';
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d={d} {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#57F287" />
          <stop offset="100%" stopColor="#3BA55D" />
        </linearGradient>
      </defs>
      <path fill={`url(#${g})`} d={d} />
    </svg>
  );
}

function BadgeFree({ className, silhouette }: Props) {
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <circle cx="12" cy="12" r="9.2" {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.2" fill="#747F8D" />
      <path
        fill="#fff"
        d="M12 6.8a5.2 5.2 0 100 10.4 5.2 5.2 0 000-10.4zm0 1.6a3.6 3.6 0 110 7.2 3.6 3.6 0 010-7.2z"
      />
    </svg>
  );
}

function BadgePro({ className, silhouette }: Props) {
  const g = useSafeId();
  const d = 'M4.8 16.2L6.6 7.5l3.5 3.8L12 5.2l1.9 6.1 3.5-3.8 1.8 8.7H4.8zm1.2 1.4h12v1.7H6z';
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d={d} {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={g} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#F7C948" />
          <stop offset="55%" stopColor="#F0B232" />
          <stop offset="100%" stopColor="#C98918" />
        </linearGradient>
      </defs>
      <path fill={`url(#${g})`} d={d} />
    </svg>
  );
}

function BadgeTenure({ className, silhouette, color }: Props & { color: string }) {
  const shield =
    'M12 2.4c3.6 1.7 6.7 2 8.8 2.1v7.4c0 4.9-3.3 8.6-8.8 10.7C7.5 20.5 3.2 16.8 3.2 11.9V4.5C5.3 4.4 8.4 4.1 12 2.4z';
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d={shield} {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill={color} d={shield} />
      <path
        fill="#fff"
        fillOpacity="0.92"
        d="M12 6.4c-2.5 0-4.2 1.5-4.2 3.7 0 1.5.8 2.6 2.1 3.2v.4c0 .7.4 1.1 1.1 1.4l.2.9h1.6l.2-.9c.7-.3 1.1-.7 1.1-1.4v-.4c1.3-.6 2.1-1.7 2.1-3.2 0-2.2-1.7-3.7-4.2-3.7zm0 1.5c1.4 0 2.4.8 2.4 2.2S13.4 12.3 12 12.3 9.6 11.5 9.6 10.1 10.6 7.9 12 7.9z"
      />
    </svg>
  );
}

function BadgeReferred({ className, silhouette }: Props) {
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d="M12 3.2l7.2 5.1v9.4a2 2 0 01-2 2H6.8a2 2 0 01-2-2V8.3L12 3.2z" {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#F26522" d="M12 3.2l7.2 5.1v9.4a2 2 0 01-2 2H6.8a2 2 0 01-2-2V8.3L12 3.2z" />
      <path fill="#FFB084" d="M12 3.2l7.2 5.1H4.8L12 3.2z" />
      <rect x="10.2" y="12.2" width="3.6" height="6.2" rx="0.5" fill="#fff" fillOpacity="0.9" />
    </svg>
  );
}

function BadgeConnector({ className, silhouette }: Props) {
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <circle cx="8.2" cy="9" r="3.4" {...silProps()} />
        <circle cx="15.8" cy="15" r="3.4" {...silProps()} />
        <path d="M10.4 10.8l3.2 2.4" stroke={SIL} strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="8.2" cy="9" r="3.4" fill="#EB459E" />
      <circle cx="15.8" cy="15" r="3.4" fill="#EB459E" />
      <path d="M10.4 10.8l3.2 2.4" stroke="#F9A8D4" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="8.2" cy="9" r="1.25" fill="#fff" />
      <circle cx="15.8" cy="15" r="1.25" fill="#fff" />
    </svg>
  );
}

function BadgeEarlyBird({ className, silhouette }: Props) {
  const g = useSafeId();
  const d =
    'M5.2 14.4c1.7-4.6 4.2-7.2 6.5-7.2 1.1 0 2.1.7 2.9 1.8 1.5-.8 3-.6 4 .2-1.2.9-1.8 2-2 3.2 1.3.3 2.3 1.1 2.8 2.4-2-.2-3.5.2-4.6 1.2-1.5 1.3-2.7 1.8-4.4 1.8-2.4 0-4.1-1.4-5.2-3.4z';
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d={d} {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0B232" />
          <stop offset="100%" stopColor="#C98918" />
        </linearGradient>
      </defs>
      <path fill={`url(#${g})`} d={d} />
      <circle cx="10.6" cy="11.2" r="0.95" fill="#3C2A10" />
      <path fill="#F26522" d="M6 13.6l-2.2.3 1.9 1.1z" />
    </svg>
  );
}

function BadgeResearcher({ className, silhouette, color }: Props & { color: string }) {
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <circle cx="10.5" cy="10.5" r="6.2" {...silProps()} />
        <path d="M14.8 14.8L19.4 19.4" stroke={SIL} strokeWidth="2.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="10.5" cy="10.5" r="5.6" fill="none" stroke={color} strokeWidth="2.2" />
      <path d="M14.8 14.8L19.4 19.4" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="10.5" cy="10.5" r="2" fill={color} fillOpacity="0.35" />
    </svg>
  );
}

function BadgeAiWatcher({ className, silhouette }: Props) {
  if (silhouette) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <ellipse cx="12" cy="12" rx="9" ry="5.8" {...silProps()} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <ellipse cx="12" cy="12" rx="9" ry="5.8" fill="#9B59B6" />
      <circle cx="12" cy="12" r="3.1" fill="#fff" />
      <circle cx="12" cy="12" r="1.35" fill="#4A1D6A" />
    </svg>
  );
}

function BadgeFallback({ className, silhouette }: Props) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {silhouette ? (
        <circle cx="12" cy="12" r="8" {...silProps()} />
      ) : (
        <circle cx="12" cy="12" r="8" fill="#747F8D" />
      )}
    </svg>
  );
}
