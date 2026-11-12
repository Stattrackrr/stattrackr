'use client';

import { BadgeInventory } from '@/components/badges/BadgeInventory';
import { BadgeStrip } from '@/components/badges/BadgeStrip';
import { displayBadgesFromIds, type EvaluatedBadge } from '@/lib/badges/evaluate';
import { AtSign, CalendarDays, Check, Copy, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export type ChatMemberProfileCardData = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  displayedBadgeIds: string[];
  badges?: EvaluatedBadge[];
  createdAt: string | null;
  membership?: 'admin' | 'pro' | 'free' | null;
};

function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = seed.charCodeAt(index) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 52%)`;
}

function formatJoinedAt(value: string | null): string {
  if (!value) return 'Join date unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Join date unknown';
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTenure(value: string | null): string | null {
  if (!value) return null;
  const joined = new Date(value);
  if (!Number.isFinite(joined.getTime())) return null;
  const days = Math.max(0, Math.floor((Date.now() - joined.getTime()) / 86_400_000));
  if (days < 1) return 'Joined today';
  if (days === 1) return '1 day on StatTrackr';
  if (days < 30) return `${days} days on StatTrackr`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} on StatTrackr`;
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days % 365) / 30);
  if (remMonths <= 0) return `${years} year${years === 1 ? '' : 's'} on StatTrackr`;
  return `${years}y ${remMonths}mo on StatTrackr`;
}

const MEMBERSHIP_META: Record<'admin' | 'pro' | 'free', { label: string; chip: string }> = {
  admin: {
    label: 'Admin',
    chip: 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40',
  },
  pro: {
    label: 'Pro',
    chip: 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40',
  },
  free: {
    label: 'Free',
    chip: 'bg-slate-500/20 text-slate-200 ring-1 ring-slate-400/30',
  },
};

/** Average colour from a profile image for the card banner. */
function sampleAvatarColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] ?? 0;
          if (a < 128) continue;
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          n += 1;
        }
        if (!n) {
          resolve(null);
          return;
        }
        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

type Props = {
  profile: ChatMemberProfileCardData;
  onClose: () => void;
  onMention?: (username: string) => void;
};

export function ChatMemberProfileCard({ profile, onClose, onMention }: Props) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [imageBannerColor, setImageBannerColor] = useState<string | null>(null);
  const name = profile.displayName || profile.username || 'Member';
  const showImage = Boolean(profile.avatarUrl) && profile.avatarUrl !== brokenUrl;
  const avatarColor = useMemo(() => getAvatarColor(name), [name]);
  const bannerColor = showImage && imageBannerColor ? imageBannerColor : avatarColor;
  const stripBadges = useMemo(
    () =>
      profile.badges && profile.badges.length > 0
        ? profile.badges
        : displayBadgesFromIds(profile.displayedBadgeIds),
    [profile.badges, profile.displayedBadgeIds]
  );
  const inventoryBadges = profile.badges ?? stripBadges;
  const initial = name.trim().charAt(0).toUpperCase() || 'M';
  const membership = profile.membership ?? 'free';
  const membershipMeta = MEMBERSHIP_META[membership];
  const tenure = formatTenure(profile.createdAt);
  const handle = profile.username ? `@${profile.username}` : null;

  useEffect(() => {
    if (!showImage || !profile.avatarUrl) {
      setImageBannerColor(null);
      return;
    }
    let cancelled = false;
    void sampleAvatarColor(profile.avatarUrl).then((color) => {
      if (!cancelled) setImageBannerColor(color);
    });
    return () => {
      cancelled = true;
    };
  }, [showImage, profile.avatarUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const copyHandle = async () => {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(handle);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} profile`}
        className="w-full max-w-sm max-h-[min(85dvh,720px)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#0d1726] shadow-2xl shadow-black/50 custom-scrollbar"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="relative h-24 overflow-hidden rounded-t-2xl"
          style={{
            background: `linear-gradient(135deg, ${bannerColor} 0%, color-mix(in srgb, ${bannerColor} 72%, #020617) 100%)`,
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-20 rounded-full bg-black/25 p-1.5 text-white/90 transition-colors hover:bg-black/40"
            aria-label="Close profile"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative px-4 pb-4">
          <div className="-mt-9 flex items-end justify-between gap-3">
            <div
              className="relative z-10 flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-[#0d1726] text-xl font-semibold text-white shadow-lg"
              style={showImage ? undefined : { backgroundColor: avatarColor }}
            >
              {showImage && profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={name}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setBrokenUrl(profile.avatarUrl)}
                />
              ) : (
                <span>{initial}</span>
              )}
            </div>
            <span
              className={`mb-1 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${membershipMeta.chip}`}
            >
              {membershipMeta.label}
            </span>
          </div>

          <div className="mt-3 min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-lg font-semibold tracking-tight text-white">{name}</h2>
              {profile.displayedBadgeIds.length > 0 ? (
                <BadgeStrip
                  badges={stripBadges}
                  selectedIds={profile.displayedBadgeIds}
                  className="shrink-0"
                />
              ) : null}
            </div>
            {handle ? (
              <div className="mt-1 flex items-center gap-1.5">
                <p className="truncate text-sm text-slate-400">{handle}</p>
                <button
                  type="button"
                  onClick={() => void copyHandle()}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
                  aria-label={copied ? 'Copied' : 'Copy username'}
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/5">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-100">{tenure ?? 'Member'}</p>
              <p className="text-xs text-slate-400">Joined {formatJoinedAt(profile.createdAt)}</p>
            </div>
          </div>

          <div className="mt-4 border-t border-white/5 pt-4">
            <BadgeInventory
              badges={inventoryBadges}
              selectedIds={profile.displayedBadgeIds}
            />
          </div>

          {handle && onMention ? (
            <button
              type="button"
              onClick={() => onMention(profile.username!)}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              <AtSign className="h-4 w-4" />
              Mention in chat
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
