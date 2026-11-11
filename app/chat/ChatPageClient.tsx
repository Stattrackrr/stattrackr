'use client';

import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_TYPES,
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_REACTION_OPTIONS,
  ChatMessage,
  ChatMessageReaction,
  ChatRoom,
  deleteChatMessage,
  editChatMessage,
  fetchChatReactions,
  fetchChatMessages,
  fetchChatRooms,
  sendChatMessage,
  toggleChatMessagePin,
  toggleChatReaction,
  uploadChatImage,
} from '@/lib/chat';
import { supabase } from '@/lib/supabaseClient';
import { useSiteOnlineCount } from '@/lib/sitePresence';
import { useRouter } from 'next/navigation';
import { ChangeEvent, UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatViewer } from '@/components/chat/useChatViewer';
import { DEFAULT_ODDS_FORMAT, readOddsFormatPreference } from '@/lib/currencyUtils';
import { CornerUpLeft, Loader2, MessageSquareText, Pin, Plus, Trash2, X } from 'lucide-react';
import { BackToPropsButton } from '@/components/BackToPropsButton';
import { BadgeStrip } from '@/components/badges/BadgeStrip';
import { displayBadgesFromIds } from '@/lib/badges/evaluate';
import {
  ChatMemberProfileCard,
  type ChatMemberProfileCardData,
} from '@/components/chat/ChatMemberProfileCard';
import { ChatComposer, type ChatComposerHandle } from '@/components/chat/ChatComposer';
import type { EvaluatedBadge } from '@/lib/badges/evaluate';
import {
  splitMentionSegments,
  toMentionHandle,
  type ChatMentionCandidate,
} from '@/lib/chatMentions';

type OddsFormat = 'american' | 'decimal';
const CHAT_ROOM_LAST_READ_PREFIX = 'chat:room-last-read:';

type ChatMemberProfile = {
  avatarUrl: string | null;
  displayedBadgeIds: string[];
  badges: EvaluatedBadge[];
  username: string | null;
  displayName: string | null;
  createdAt: string | null;
  membership: 'admin' | 'pro' | 'free' | null;
};

type MemberProfileApiRow = {
  avatarUrl?: string | null;
  displayedBadgeIds?: string[];
  badges?: EvaluatedBadge[];
  username?: string | null;
  displayName?: string | null;
  createdAt?: string | null;
  membership?: 'admin' | 'pro' | 'free' | null;
};

type ChatTimelineItem =
  | { type: 'divider'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage };

type ChatReactionSummary = {
  emoji: string;
  count: number;
  reacted: boolean;
};

const MESSAGE_COOLDOWN_MS = 5000;
const MESSAGE_COOLDOWN_TEXT = 'Message cooldown, wait 5 seconds.';

function isMissingReactionTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: string; message?: string; details?: string; hint?: string };
  const combinedText = [maybeError.message, maybeError.details, maybeError.hint].filter(Boolean).join(' ').toLowerCase();

  return (
    maybeError.code === '42P01' ||
    maybeError.code === 'PGRST205' ||
    combinedText.includes('chat_message_reactions') ||
    combinedText.includes('schema cache')
  );
}

function getChatErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message || null;
  }

  if (!error || typeof error !== 'object') {
    return null;
  }

  const maybeError = error as { message?: string };
  return typeof maybeError.message === 'string' ? maybeError.message : null;
}

function isExpectedChatRateLimitError(error: unknown): boolean {
  const message = getChatErrorMessage(error)?.toLowerCase() ?? '';

  return (
    message.includes('message cooldown') ||
    message.includes('wait a moment before sending another message') ||
    message.includes('sending messages too quickly')
  );
}

function isFiveSecondCooldownError(error: unknown): boolean {
  const message = getChatErrorMessage(error)?.toLowerCase() ?? '';
  return message.includes('message cooldown');
}

function buildReactionMap(
  reactions: ChatMessageReaction[],
  viewerUserId: string | null
): Map<string, ChatReactionSummary[]> {
  const messageReactionMap = new Map<string, Map<string, ChatReactionSummary>>();

  for (const reaction of reactions) {
    const emojiMap = messageReactionMap.get(reaction.message_id) ?? new Map<string, ChatReactionSummary>();
    const existingSummary = emojiMap.get(reaction.emoji);

    if (existingSummary) {
      existingSummary.count += 1;
      existingSummary.reacted = existingSummary.reacted || reaction.user_id === viewerUserId;
    } else {
      emojiMap.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        reacted: reaction.user_id === viewerUserId,
      });
    }

    messageReactionMap.set(reaction.message_id, emojiMap);
  }

  const summarizedMap = new Map<string, ChatReactionSummary[]>();
  for (const [messageId, emojiMap] of messageReactionMap.entries()) {
    summarizedMap.set(
      messageId,
      Array.from(emojiMap.values()).sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.emoji.localeCompare(right.emoji);
      })
    );
  }

  return summarizedMap;
}

function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = seed.charCodeAt(index) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 52%)`;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getOrdinal(day: number): string {
  const mod10 = day % 10;
  const mod100 = day % 100;

  if (mod10 === 1 && mod100 !== 11) return `${day}st`;
  if (mod10 === 2 && mod100 !== 12) return `${day}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${day}rd`;
  return `${day}th`;
}

function formatTimelineDivider(date: Date, now: Date): string {
  const todayKey = getLocalDateKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = getLocalDateKey(yesterday);
  const dateKey = getLocalDateKey(date);

  if (dateKey === todayKey) {
    return 'Today';
  }

  if (dateKey === yesterdayKey) {
    return 'Yesterday';
  }

  const baseLabel = `${getOrdinal(date.getDate())} of ${date.toLocaleString([], { month: 'long' })}`;
  if (date.getFullYear() !== now.getFullYear()) {
    return `${baseLabel} ${date.getFullYear()}`;
  }

  return baseLabel;
}

function ChatAvatar({
  name,
  avatarUrl,
  size = 'sm',
  onClick,
}: {
  name: string;
  avatarUrl: string | null;
  size?: 'sm' | 'md';
  onClick?: () => void;
}) {
  const dimension = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  const initial = name.trim().charAt(0).toUpperCase() || 'C';
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl) && avatarUrl !== brokenUrl;
  const className = `${dimension} rounded-full overflow-hidden flex items-center justify-center font-semibold text-white shrink-0 ${
    onClick ? 'cursor-pointer transition-opacity hover:opacity-90' : ''
  }`;
  const style = showImage ? undefined : { backgroundColor: getAvatarColor(name) };
  const content =
    showImage && avatarUrl ? (
      <img
        key={avatarUrl}
        src={avatarUrl}
        alt={name}
        className="w-full h-full object-cover"
        referrerPolicy="no-referrer"
        onError={() => setBrokenUrl(avatarUrl)}
      />
    ) : (
      <span>{initial}</span>
    );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} style={style} aria-label={`View ${name}'s profile`}>
        {content}
      </button>
    );
  }

  return (
    <div className={className} style={style}>
      {content}
    </div>
  );
}

function getChatRoomLastReadKey(userId: string, roomId: string): string {
  return `${CHAT_ROOM_LAST_READ_PREFIX}${userId}:${roomId}`;
}

function getChatRoomLastRead(userId: string, roomId: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(getChatRoomLastReadKey(userId, roomId));
  } catch {
    return null;
  }
}

function markChatRoomAsRead(userId: string, roomId: string, timestamp = new Date().toISOString()) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getChatRoomLastReadKey(userId, roomId), timestamp);
  } catch {
    // Ignore storage access failures on restricted browsers.
  }
}

export default function ChatPageClient() {
  const router = useRouter();
  const [viewer, setViewer] = useChatViewer('Chat page');
  const canChat = Boolean(viewer.userId);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('room') === 'picks') router.replace('/picks');
  }, [router]);
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>(DEFAULT_ODDS_FORMAT);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomUnreadCounts, setRoomUnreadCounts] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ChatMessageReaction[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [confirmDeleteMessageId, setConfirmDeleteMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageValue, setEditingMessageValue] = useState('');
  const [savingEditMessageId, setSavingEditMessageId] = useState<string | null>(null);
  const [pinningMessageId, setPinningMessageId] = useState<string | null>(null);
  const [togglingReactionKey, setTogglingReactionKey] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [messageCooldownUntil, setMessageCooldownUntil] = useState<number | null>(null);
  const [composerImage, setComposerImage] = useState<{ file: File; preview: string } | null>(null);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const onlineCount = useSiteOnlineCount();
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, ChatMemberProfile>>({});
  const [profileCard, setProfileCard] = useState<ChatMemberProfileCardData | null>(null);
  const memberProfilesFetchedRef = useRef<Set<string>>(new Set());

  const messageListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const messageCooldownTimeoutRef = useRef<number | null>(null);
  const isMessageListNearBottomRef = useRef(true);
  const shouldScrollToBottomRef = useRef(true);
  const previousRoomIdRef = useRef<string | null>(null);

  const replyTarget = useMemo(
    () => messages.find((message) => message.id === replyTargetId) ?? null,
    [messages, replyTargetId]
  );
  const reactionsByMessage = useMemo(
    () => buildReactionMap(reactions, viewer.userId),
    [reactions, viewer.userId]
  );
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId]
  );
  // Keep the open room in the URL so a refresh lands back on it.
  useEffect(() => {
    if (!selectedRoom) return;
    const url = new URL(window.location.href);
    if (selectedRoom.slug === 'general') url.searchParams.delete('room');
    else url.searchParams.set('room', selectedRoom.slug);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
  }, [selectedRoom]);
  const pinnedMessages = useMemo(
    () =>
      messages
        .filter((message) => message.pinned_at)
        .sort((left, right) => new Date(right.pinned_at ?? 0).getTime() - new Date(left.pinned_at ?? 0).getTime()),
    [messages]
  );
  const mentionCandidates = useMemo(() => {
    const byId = new Map<string, ChatMentionCandidate>();
    for (const message of messages) {
      const profile = memberProfiles[message.user_id];
      const label = profile?.displayName || message.display_name || profile?.username || 'Member';
      const handle = toMentionHandle(profile?.username || message.display_name || profile?.displayName);
      if (!handle) continue;
      const existing = byId.get(message.user_id);
      const messagedAt = new Date(message.created_at).getTime();
      byId.set(message.user_id, {
        userId: message.user_id,
        handle: profile?.username ? handle : existing?.handle ?? handle,
        label,
        avatarUrl: profile?.avatarUrl ?? message.avatar_url ?? existing?.avatarUrl ?? null,
        lastMessagedAt: Math.max(existing?.lastMessagedAt ?? 0, Number.isFinite(messagedAt) ? messagedAt : 0),
      });
    }
    for (const [userId, profile] of Object.entries(memberProfiles)) {
      const handle = toMentionHandle(profile.username || profile.displayName);
      if (!handle) continue;
      const existing = byId.get(userId);
      byId.set(userId, {
        userId,
        handle: profile.username ? handle : existing?.handle ?? handle,
        label: profile.displayName || profile.username || existing?.label || handle,
        avatarUrl: profile.avatarUrl ?? existing?.avatarUrl ?? null,
        lastMessagedAt: existing?.lastMessagedAt ?? 0,
      });
    }
    return Array.from(byId.values());
  }, [memberProfiles, messages]);
  const mentionHandleMap = useMemo(() => {
    const map = new Map<string, ChatMentionCandidate>();
    for (const candidate of mentionCandidates) {
      map.set(candidate.handle.toLowerCase(), candidate);
    }
    return map;
  }, [mentionCandidates]);
  const knownMentionHandles = useMemo(
    () => new Set(Array.from(mentionHandleMap.keys())),
    [mentionHandleMap]
  );
  const isMessageCooldownActive = Boolean(messageCooldownUntil && messageCooldownUntil > Date.now());
  const timelineItems = useMemo(() => {
    const now = new Date();
    const items: ChatTimelineItem[] = [];
    let previousDateKey: string | null = null;

    for (const message of messages) {
      const messageDate = new Date(message.created_at);
      const messageDateKey = getLocalDateKey(messageDate);

      if (messageDateKey !== previousDateKey) {
        items.push({
          type: 'divider',
          key: `divider-${messageDateKey}`,
          label: formatTimelineDivider(messageDate, now),
        });
        previousDateKey = messageDateKey;
      }

      items.push({
        type: 'message',
        key: message.id,
        message,
      });
    }

    return items;
  }, [messages]);

  const refreshReactions = useCallback(async (nextMessages: ChatMessage[]) => {
    const messageIds = nextMessages.map((message) => message.id);

    if (messageIds.length === 0) {
      setReactions([]);
      return [];
    }

    const loadedReactions = await fetchChatReactions(messageIds);
    setReactions(loadedReactions);
    return loadedReactions;
  }, []);

  const readOwnDisplayedBadgeIds = useCallback((): string[] | null => {
    try {
      const raw = localStorage.getItem('stattrackr_displayed_badges');
      if (raw == null) return null;
      const local = JSON.parse(raw) as unknown;
      if (!Array.isArray(local) || !local.every((x) => typeof x === 'string')) return null;
      return local.slice(0, 2);
    } catch {
      return null;
    }
  }, []);

  // Own equipped badges: same source as the sidebar (localStorage + /api/badges/me).
  useEffect(() => {
    if (!viewer.userId || viewer.loading) return;

    let cancelled = false;

    const applyOwnBadges = (ids: string[], inventory?: EvaluatedBadge[]) => {
      setMemberProfiles((current) => {
        const existing = current[viewer.userId!];
        const nextBadges = inventory ?? existing?.badges ?? [];
        if (
          existing &&
          existing.displayedBadgeIds.length === ids.length &&
          existing.displayedBadgeIds.every((id, index) => id === ids[index]) &&
          (!inventory || existing.badges === nextBadges)
        ) {
          return current;
        }
        return {
          ...current,
          [viewer.userId!]: {
            avatarUrl: existing?.avatarUrl ?? viewer.avatarUrl,
            displayedBadgeIds: ids,
            badges: nextBadges,
            username: existing?.username ?? viewer.username,
            displayName: existing?.displayName ?? viewer.username,
            createdAt: existing?.createdAt ?? null,
            membership:
              existing?.membership ??
              (viewer.isAdmin ? 'admin' : viewer.hasPremium ? 'pro' : 'free'),
          },
        };
      });
    };

    const localIds = readOwnDisplayedBadgeIds();
    if (localIds) applyOwnBadges(localIds);

    const loadOwnBadges = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        const res = await fetch('/api/badges/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;

        const json = (await res.json()) as {
          displayedBadgeIds?: string[];
          badges?: EvaluatedBadge[];
        };
        if (cancelled) return;

        // Match LeftSidebar: local customization wins when present (column may lag).
        const fromLocal = readOwnDisplayedBadgeIds();
        const nextIds = fromLocal ?? (Array.isArray(json.displayedBadgeIds) ? json.displayedBadgeIds : []);
        applyOwnBadges(nextIds, Array.isArray(json.badges) ? json.badges : undefined);
      } catch (error) {
        console.warn('Chat page: failed to load own badges', error);
      }
    };

    void loadOwnBadges();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'stattrackr_displayed_badges') return;
      const ids = readOwnDisplayedBadgeIds();
      if (ids) applyOwnBadges(ids);
    };
    const onLocalBadges = (event: Event) => {
      const detail = (event as CustomEvent<{ displayedBadgeIds?: string[] }>).detail;
      if (Array.isArray(detail?.displayedBadgeIds)) {
        applyOwnBadges(detail.displayedBadgeIds.slice(0, 2));
        return;
      }
      const ids = readOwnDisplayedBadgeIds();
      if (ids) applyOwnBadges(ids);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('stattrackr:displayed-badges', onLocalBadges);

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('stattrackr:displayed-badges', onLocalBadges);
    };
  }, [readOwnDisplayedBadgeIds, viewer.avatarUrl, viewer.loading, viewer.userId]);

  // Live avatars + profile fields for message authors (avatar_url is snapshotted at send time).
  useEffect(() => {
    if (!canChat || viewer.loading) return;

    const uniqueIds = [
      ...new Set(messages.map((message) => message.user_id).filter((id): id is string => Boolean(id))),
    ];
    const missingIds = uniqueIds.filter((id) => !memberProfilesFetchedRef.current.has(id));
    if (missingIds.length === 0) return;

    for (const id of missingIds) {
      memberProfilesFetchedRef.current.add(id);
    }

    let cancelled = false;

    const loadMemberProfiles = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }

        const res = await fetch('/api/chat/member-profiles', {
          method: 'POST',
          headers,
          body: JSON.stringify({ userIds: missingIds }),
        });
        if (!res.ok) {
          throw new Error(`member-profiles ${res.status}`);
        }

        const json = (await res.json()) as {
          profiles?: Record<string, MemberProfileApiRow>;
        };
        if (cancelled) return;

        const next = json.profiles ?? {};
        const ownBadgeOverride = readOwnDisplayedBadgeIds();
        setMemberProfiles((current) => {
          const merged = { ...current };
          for (const [id, profile] of Object.entries(next)) {
            const existing = merged[id];
            const isSelf = id === viewer.userId;
            merged[id] = {
              avatarUrl: profile.avatarUrl ?? existing?.avatarUrl ?? null,
              displayedBadgeIds: isSelf
                ? ownBadgeOverride ?? existing?.displayedBadgeIds ?? (Array.isArray(profile.displayedBadgeIds) ? profile.displayedBadgeIds : [])
                : Array.isArray(profile.displayedBadgeIds)
                  ? profile.displayedBadgeIds
                  : [],
              badges: Array.isArray(profile.badges) ? profile.badges : existing?.badges ?? [],
              username: profile.username ?? existing?.username ?? null,
              displayName: profile.displayName ?? existing?.displayName ?? null,
              createdAt: profile.createdAt ?? existing?.createdAt ?? null,
              membership: profile.membership ?? existing?.membership ?? null,
            };
          }
          return merged;
        });
      } catch (error) {
        console.warn('Chat page: failed to load member profiles', error);
        for (const id of missingIds) {
          memberProfilesFetchedRef.current.delete(id);
        }
      }
    };

    void loadMemberProfiles();
    return () => {
      cancelled = true;
      // Allow a remount / dependency change to retry (React Strict Mode safe).
      for (const id of missingIds) {
        memberProfilesFetchedRef.current.delete(id);
      }
    };
  }, [canChat, messages, readOwnDisplayedBadgeIds, viewer.loading, viewer.userId]);

  // Keep the viewer's own chat avatar in sync when they change it in the sidebar.
  useEffect(() => {
    if (!viewer.userId || viewer.loading) return;
    setMemberProfiles((current) => {
      const existing = current[viewer.userId!];
      if (existing && existing.avatarUrl === viewer.avatarUrl) return current;
      return {
        ...current,
        [viewer.userId!]: {
          avatarUrl: viewer.avatarUrl,
          displayedBadgeIds: existing?.displayedBadgeIds ?? readOwnDisplayedBadgeIds() ?? [],
          badges: existing?.badges ?? [],
          username: existing?.username ?? viewer.username,
          displayName: existing?.displayName ?? viewer.username,
          createdAt: existing?.createdAt ?? null,
          membership:
            existing?.membership ??
            (viewer.isAdmin ? 'admin' : viewer.hasPremium ? 'pro' : 'free'),
        },
      };
    });
  }, [
    readOwnDisplayedBadgeIds,
    viewer.avatarUrl,
    viewer.hasPremium,
    viewer.isAdmin,
    viewer.loading,
    viewer.userId,
    viewer.username,
  ]);

  const openMemberProfile = useCallback(
    (userId: string, fallbackName: string, fallbackAvatar: string | null) => {
      const profile = memberProfiles[userId];
      const card: ChatMemberProfileCardData = {
        userId,
        displayName: profile?.displayName || fallbackName || 'Member',
        username: profile?.username ?? null,
        avatarUrl: profile?.avatarUrl ?? fallbackAvatar,
        displayedBadgeIds:
          userId === viewer.userId
            ? profile?.displayedBadgeIds ?? readOwnDisplayedBadgeIds() ?? []
            : profile?.displayedBadgeIds ?? [],
        badges: profile?.badges ?? [],
        createdAt: profile?.createdAt ?? null,
        membership: profile?.membership ?? null,
      };
      setProfileCard(card);

      // If join date / badge inventory hasn't loaded yet, fetch this member on demand.
      if (profile?.createdAt && profile.membership && (profile.badges?.length ?? 0) > 0) return;

      void (async () => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const headers: HeadersInit = { 'Content-Type': 'application/json' };
          if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`;
          }
          const res = await fetch('/api/chat/member-profiles', {
            method: 'POST',
            headers,
            body: JSON.stringify({ userIds: [userId] }),
          });
          if (!res.ok) return;
          const json = (await res.json()) as { profiles?: Record<string, MemberProfileApiRow> };
          const row = json.profiles?.[userId];
          if (!row) return;

          const ownBadges =
            userId === viewer.userId ? readOwnDisplayedBadgeIds() : null;
          const nextProfile: ChatMemberProfile = {
            avatarUrl: row.avatarUrl ?? profile?.avatarUrl ?? fallbackAvatar,
            displayedBadgeIds:
              ownBadges ??
              (Array.isArray(row.displayedBadgeIds)
                ? row.displayedBadgeIds
                : profile?.displayedBadgeIds ?? []),
            badges: Array.isArray(row.badges) ? row.badges : profile?.badges ?? [],
            username: row.username ?? profile?.username ?? null,
            displayName: row.displayName ?? profile?.displayName ?? fallbackName,
            createdAt: row.createdAt ?? profile?.createdAt ?? null,
            membership: row.membership ?? profile?.membership ?? null,
          };
          setMemberProfiles((current) => ({ ...current, [userId]: nextProfile }));
          memberProfilesFetchedRef.current.add(userId);
          setProfileCard((current) =>
            current?.userId === userId
              ? {
                  userId,
                  displayName: nextProfile.displayName || fallbackName || 'Member',
                  username: nextProfile.username,
                  avatarUrl: nextProfile.avatarUrl,
                  displayedBadgeIds: nextProfile.displayedBadgeIds,
                  badges: nextProfile.badges,
                  createdAt: nextProfile.createdAt,
                  membership: nextProfile.membership,
                }
              : current
          );
        } catch (error) {
          console.warn('Chat page: failed to load clicked member profile', error);
        }
      })();
    },
    [memberProfiles, readOwnDisplayedBadgeIds, viewer.userId]
  );

  const loadMessages = useCallback(
    async (roomId: string, options?: { silent?: boolean; preserveError?: boolean }) => {
      const { silent = false, preserveError = false } = options ?? {};

      if (!silent) {
        setLoadingMessages(true);
      }
      if (!preserveError) {
        setThreadError(null);
      }

      try {
        const loadedMessages = await fetchChatMessages(roomId);
        try {
          await refreshReactions(loadedMessages);
        } catch (reactionError) {
          setReactions([]);
          console.warn('Chat page: reactions unavailable while loading messages', reactionError);
        }
        setMessages(loadedMessages);
        return loadedMessages;
      } catch (error) {
        console.error('Chat page: failed to load messages', error);
        setThreadError('Unable to load messages for this room.');
        return null;
      } finally {
        if (!silent) {
          setLoadingMessages(false);
        }
      }
    },
    [refreshReactions]
  );

  useEffect(() => {
    try {
      setOddsFormat(readOddsFormatPreference());
    } catch {
      // Ignore local storage access issues.
    }
  }, []);

  useEffect(() => {
    if (viewer.loading || !canChat) return;

    let isMounted = true;
    setLoadingRooms(true);
    setRoomError(null);

    fetchChatRooms()
      .then((allRooms) => {
        if (!isMounted) return;
        const loadedRooms = allRooms.filter((room) => room.slug !== 'picks');
        setRooms(loadedRooms);
        setSelectedRoomId((currentRoomId) => {
          const generalRoomId = loadedRooms.find((room) => room.slug === 'general')?.id ?? loadedRooms[0]?.id ?? null;
          const currentRoom = loadedRooms.find((room) => room.id === currentRoomId);
          if (currentRoomId && currentRoom) {
            return currentRoomId;
          }
          const urlRoomSlug = new URLSearchParams(window.location.search).get('room');
          return loadedRooms.find((room) => room.slug === urlRoomSlug)?.id ?? generalRoomId;
        });
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        console.error('Chat page: failed to load chat rooms', error);
        setRoomError('Unable to load chat rooms right now.');
      })
      .finally(() => {
        if (isMounted) {
          setLoadingRooms(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canChat, viewer.loading]);

  useEffect(() => {
    if (!canChat || !selectedRoomId) {
      setMessages([]);
      setReactions([]);
      setReplyTargetId(null);
      setReactionPickerMessageId(null);
      return;
    }

    let isMounted = true;
    if (viewer.userId) {
      markChatRoomAsRead(viewer.userId, selectedRoomId);
    }
    setRoomUnreadCounts((current) => {
      if (!current[selectedRoomId]) return current;
      const nextCounts = { ...current };
      delete nextCounts[selectedRoomId];
      return nextCounts;
    });

    void loadMessages(selectedRoomId).then(() => {
      if (!isMounted) return;
    });

    return () => {
      isMounted = false;
    };
  }, [loadMessages, selectedRoomId, canChat, viewer.userId]);

  useEffect(() => {
    if (!canChat || !viewer.userId || !selectedRoomId || rooms.length === 0) return;

    let isMounted = true;

    const loadRoomUnreadCounts = async () => {
      const nextCounts: Record<string, number> = {};

      await Promise.all(
        rooms.map(async (room) => {
          if (room.id === selectedRoomId) {
            return;
          }

          try {
            const lastReadAt = getChatRoomLastRead(viewer.userId!, room.id);
            let query = (supabase
              .from('chat_messages') as any)
              .select('id', { count: 'exact', head: true })
              .eq('room_id', room.id)
              .is('deleted_at', null);

            if (lastReadAt) {
              query = query.gt('created_at', lastReadAt);
            }

            const { count, error } = await query;
            if (!error && count && count > 0) {
              nextCounts[room.id] = count;
            }
          } catch {
            // Room badges are a hint only; realtime and polling can refresh later.
          }
        })
      );

      if (isMounted) {
        setRoomUnreadCounts(nextCounts);
      }
    };

    void loadRoomUnreadCounts();

    return () => {
      isMounted = false;
    };
  }, [rooms, selectedRoomId, canChat, viewer.userId]);

  useEffect(() => {
    if (!canChat || rooms.length === 0) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel('chat-room-unread-indicators')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
          },
          (payload) => {
            const nextMessage = payload.new as ChatMessage;
            if (!rooms.some((room) => room.id === nextMessage.room_id)) {
              return;
            }

            setRoomUnreadCounts((current) => {
              if (nextMessage.room_id === selectedRoomId) {
                if (!current[nextMessage.room_id]) return current;
                const nextCounts = { ...current };
                delete nextCounts[nextMessage.room_id];
                return nextCounts;
              }

              return {
                ...current,
                [nextMessage.room_id]: (current[nextMessage.room_id] ?? 0) + 1,
              };
            });
          }
        )
        .subscribe((status, error) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('Chat page: room unread indicators unavailable', error ?? status);
          }
        });
    } catch (error) {
      console.warn('Chat page: failed to start room unread indicator subscription', error);
      channel = null;
    }

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [rooms, selectedRoomId, canChat]);

  useEffect(() => {
    if (!reactionPickerMessageId) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (target.closest('[data-reaction-picker]') || target.closest('[data-reaction-toggle]')) {
        return;
      }

      setReactionPickerMessageId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [reactionPickerMessageId]);

  useEffect(() => {
    return () => {
      if (messageCooldownTimeoutRef.current !== null) {
        window.clearTimeout(messageCooldownTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!canChat || !selectedRoomId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel(`chat-room-${selectedRoomId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `room_id=eq.${selectedRoomId}`,
          },
          (payload) => {
            const nextMessage = payload.new as ChatMessage;
            setMessages((current) => {
              if (current.some((message) => message.id === nextMessage.id)) {
                return current;
              }
              return [...current, nextMessage].sort(
                (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
              );
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'chat_messages',
            filter: `room_id=eq.${selectedRoomId}`,
          },
          (payload) => {
            const nextMessage = payload.new as ChatMessage;
            setMessages((current) => {
              if (nextMessage.deleted_at) {
                return current.filter((message) => message.id !== nextMessage.id);
              }

              const hasMessage = current.some((message) => message.id === nextMessage.id);
              const nextMessages = hasMessage
                ? current.map((message) => (message.id === nextMessage.id ? nextMessage : message))
                : [...current, nextMessage];

              return nextMessages.sort(
                (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
              );
            });
          }
        )
        .subscribe((status, error) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('Chat page: realtime unavailable, polling fallback remains active', error ?? status);
          }
        });
    } catch (error) {
      console.warn('Chat page: failed to start realtime subscription, polling fallback remains active', error);
      channel = null;
    }

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [selectedRoomId, canChat]);

  useEffect(() => {
    if (!canChat || !selectedRoomId) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadMessages(selectedRoomId, { silent: true, preserveError: true });
    }, 3000);

    const syncMessages = () => {
      if (document.visibilityState === 'hidden') return;
      void loadMessages(selectedRoomId, { silent: true, preserveError: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncMessages();
      }
    };

    window.addEventListener('focus', syncMessages);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncMessages);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadMessages, selectedRoomId, canChat]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;

    const roomChanged = previousRoomIdRef.current !== selectedRoomId;
    previousRoomIdRef.current = selectedRoomId;

    if (roomChanged || shouldScrollToBottomRef.current || isMessageListNearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      isMessageListNearBottomRef.current = true;
    }

    shouldScrollToBottomRef.current = false;
  }, [messages, selectedRoomId]);

  /** Images have no height until they load; re-pin so a late photo doesn't push the newest message out of view. */
  const keepPinnedAfterImageLoad = useCallback(() => {
    const container = messageListRef.current;
    if (container && isMessageListNearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const handleMessageListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isMessageListNearBottomRef.current = distanceFromBottom < 120;
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    document
      .getElementById(`chat-message-${messageId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const scrollToPinnedMessages = useCallback(() => {
    document
      .getElementById('chat-pinned-messages')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSubscriptionClick = async () => {
    if (!viewer.hasPremium) {
      router.push('/subscription');
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/subscription');
        return;
      }

      const response = await fetch('/api/portal-client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = (await response.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
    } catch (error) {
      console.error('Chat page: failed to open billing portal', error);
    }

    router.push('/subscription');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    router.push('/');
  };

  const startMessageCooldown = useCallback((durationMs = MESSAGE_COOLDOWN_MS) => {
    if (messageCooldownTimeoutRef.current !== null) {
      window.clearTimeout(messageCooldownTimeoutRef.current);
    }

    const nextCooldownUntil = Date.now() + durationMs;
    setMessageCooldownUntil(nextCooldownUntil);
    setComposerError(MESSAGE_COOLDOWN_TEXT);

    messageCooldownTimeoutRef.current = window.setTimeout(() => {
      setMessageCooldownUntil((current) => (current === nextCooldownUntil ? null : current));
      setComposerError((current) => (current === MESSAGE_COOLDOWN_TEXT ? null : current));
      messageCooldownTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const submitMessage = useCallback(async (rawBody: string) => {
    if (!selectedRoomId || !canChat || sendingMessage) {
      return;
    }

    if (messageCooldownUntil && messageCooldownUntil > Date.now()) {
      setComposerError(MESSAGE_COOLDOWN_TEXT);
      return;
    }

    if (messageCooldownUntil) {
      setMessageCooldownUntil(null);
    }

    const trimmedMessage = rawBody.trim();
    const image = viewer.isAdmin ? composerImage : null;
    if (!trimmedMessage && !image) {
      return;
    }

    if (trimmedMessage.length > CHAT_MAX_MESSAGE_LENGTH) {
      setComposerError(`Messages must be ${CHAT_MAX_MESSAGE_LENGTH} characters or less.`);
      return;
    }

    setSendingMessage(true);
    setComposerError(null);

    try {
      const imageUrl = image && viewer.userId ? await uploadChatImage(image.file, viewer.userId) : null;
      const createdMessage = await sendChatMessage(selectedRoomId, trimmedMessage, replyTargetId, imageUrl);
      if (image) {
        URL.revokeObjectURL(image.preview);
        setComposerImage(null);
      }
      shouldScrollToBottomRef.current = true;
      setMessages((current) => {
        if (current.some((message) => message.id === createdMessage.id)) {
          return current;
        }
        return [...current, createdMessage];
      });
      composerRef.current?.clear();
      setReplyTargetId(null);
      void loadMessages(selectedRoomId, { silent: true, preserveError: true });
    } catch (error) {
      const fallbackError = 'Unable to send your message right now.';
      const errorMessage = getChatErrorMessage(error);

      if (isExpectedChatRateLimitError(error)) {
        if (isFiveSecondCooldownError(error)) {
          startMessageCooldown();
        } else {
          setComposerError(errorMessage || fallbackError);
        }
        return;
      }

      console.error('Chat page: failed to send message', error);
      setComposerError(errorMessage || fallbackError);
    } finally {
      setSendingMessage(false);
    }
  }, [
    composerImage,
    loadMessages,
    messageCooldownUntil,
    replyTargetId,
    selectedRoomId,
    sendingMessage,
    startMessageCooldown,
    canChat,
    viewer.isAdmin,
    viewer.userId,
  ]);

  const handlePickImage = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setComposerError('Photos must be PNG, JPG, WebP or GIF.');
      return;
    }
    if (file.size > CHAT_IMAGE_MAX_BYTES) {
      setComposerError('Photos must be 5MB or smaller.');
      return;
    }
    setComposerError(null);
    setComposerImage((current) => {
      if (current) URL.revokeObjectURL(current.preview);
      return { file, preview: URL.createObjectURL(file) };
    });
  }, []);

  useEffect(() => {
    if (!expandedImageUrl) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedImageUrl(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedImageUrl]);

  const clearComposerImage = useCallback(() => {
    setComposerImage((current) => {
      if (current) URL.revokeObjectURL(current.preview);
      return null;
    });
  }, []);

  const handleSelectRoom = useCallback((roomId: string) => {
    setSelectedRoomId(roomId);
    composerRef.current?.clear();
    setComposerError(null);
    setReplyTargetId(null);
    setReactionPickerMessageId(null);
    setConfirmDeleteMessageId(null);
    setEditingMessageId(null);
    setEditingMessageValue('');
  }, []);

  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!viewer.userId || !canChat || togglingReactionKey) {
        return;
      }

      const reactionKey = `${messageId}:${emoji}`;
      setTogglingReactionKey(reactionKey);
      setReactionPickerMessageId(null);

      try {
        await toggleChatReaction(messageId, viewer.userId, emoji);
        try {
          await refreshReactions(messages);
        } catch (reactionError) {
          setReactions([]);
          console.warn('Chat page: reactions unavailable after toggle', reactionError);
        }
      } catch (error) {
        console.error('Chat page: failed to toggle reaction', error);
        setComposerError(
          isMissingReactionTableError(error)
            ? 'Run the chat reactions SQL migration to enable reactions.'
            : 'Unable to update your reaction right now.'
        );
      } finally {
        setTogglingReactionKey(null);
      }
    },
    [messages, refreshReactions, togglingReactionKey, canChat, viewer.userId]
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!selectedRoomId || deletingMessageId) {
        return;
      }

      setDeletingMessageId(messageId);
      setConfirmDeleteMessageId(null);
      setReactionPickerMessageId(null);

      try {
        await deleteChatMessage(messageId);
        setMessages((current) => current.filter((message) => message.id !== messageId));
        setReactions((current) => current.filter((reaction) => reaction.message_id !== messageId));
        setReplyTargetId((current) => (current === messageId ? null : current));
        void loadMessages(selectedRoomId, { silent: true, preserveError: true });
      } catch (error) {
        console.error('Chat page: failed to delete message', error);
        setComposerError('Unable to delete this message right now.');
      } finally {
        setDeletingMessageId(null);
      }
    },
    [deletingMessageId, loadMessages, selectedRoomId]
  );

  const startEditingMessage = useCallback((message: ChatMessage) => {
    setReactionPickerMessageId(null);
    setConfirmDeleteMessageId(null);
    setEditingMessageId(message.id);
    setEditingMessageValue(message.body);
    setComposerError(null);
  }, []);

  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditingMessageValue('');
  }, []);

  const handleSaveEditedMessage = useCallback(
    async (messageId: string) => {
      if (!selectedRoomId || savingEditMessageId) {
        return;
      }

      const trimmedMessage = editingMessageValue.trim();
      if (!trimmedMessage) {
        setComposerError('Message cannot be empty.');
        return;
      }

      if (trimmedMessage.length > CHAT_MAX_MESSAGE_LENGTH) {
        setComposerError(`Messages must be ${CHAT_MAX_MESSAGE_LENGTH} characters or less.`);
        return;
      }

      setSavingEditMessageId(messageId);
      setComposerError(null);

      try {
        const updatedMessage = await editChatMessage(messageId, trimmedMessage);
        setMessages((current) =>
          current.map((message) => (message.id === updatedMessage.id ? updatedMessage : message))
        );
        setEditingMessageId(null);
        setEditingMessageValue('');
        void loadMessages(selectedRoomId, { silent: true, preserveError: true });
      } catch (error) {
        console.error('Chat page: failed to edit message', error);
        setComposerError(getChatErrorMessage(error) || 'Unable to edit this message right now.');
      } finally {
        setSavingEditMessageId(null);
      }
    },
    [editingMessageValue, loadMessages, savingEditMessageId, selectedRoomId]
  );

  const handleTogglePinMessage = useCallback(
    async (messageId: string) => {
      if (!selectedRoomId || pinningMessageId || !viewer.isAdmin) {
        return;
      }

      setPinningMessageId(messageId);
      setReactionPickerMessageId(null);
      setConfirmDeleteMessageId(null);

      try {
        const updatedMessage = await toggleChatMessagePin(messageId);
        setMessages((current) =>
          current
            .map((message) => (message.id === updatedMessage.id ? updatedMessage : message))
            .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
        );
        void loadMessages(selectedRoomId, { silent: true, preserveError: true });
      } catch (error) {
        console.error('Chat page: failed to toggle pinned message', error);
        setComposerError('Unable to update pinned message right now.');
      } finally {
        setPinningMessageId(null);
      }
    },
    [loadMessages, pinningMessageId, selectedRoomId, viewer.isAdmin]
  );

  return (
    <div className="dashboard-container fixed inset-0 min-h-0 overflow-hidden bg-gray-50 text-gray-900 transition-colors dark:bg-[#050d1a] dark:text-white">
      <style jsx global>{`
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 0px;
          --gap: 2px;
          --inner-max: 1550px;
          --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max));
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }

        @media (min-width: 1024px) {
          .dashboard-container {
            --sidebar-width: 340px;
            --right-panel-width: 340px;
          }
        }

        @media (min-width: 1500px) {
          .dashboard-container {
            --sidebar-margin: 0px;
            --sidebar-width: 400px;
            --right-panel-width: 400px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }

        @media (min-width: 2200px) {
          .dashboard-container {
            --sidebar-margin: 0px;
            --sidebar-width: 460px;
            --right-panel-width: 460px;
            --content-margin-right: 0px;
            --content-padding-left: 0px;
            --content-padding-right: 0px;
          }
        }

      `}</style>

      <DashboardLeftSidebarWrapper
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        oddsFormat={oddsFormat}
        setOddsFormat={setOddsFormat}
        hasPremium={viewer.hasPremium}
        avatarUrl={viewer.avatarUrl}
        username={viewer.username}
        userEmail={viewer.userEmail}
        isPro={viewer.hasPremium}
        onSubscriptionClick={handleSubscriptionClick}
        onSignOutClick={handleLogout}
        onProfileUpdated={({ username, full_name, avatar_url }) => {
          const nextUsername = username ?? full_name ?? null;
          setViewer((current) => ({
            ...current,
            username: nextUsername ?? current.username,
            avatarUrl: avatar_url ?? current.avatarUrl,
          }));
          if (viewer.userId) {
            setMemberProfiles((current) => {
              const existing = current[viewer.userId!];
              return {
                ...current,
                [viewer.userId!]: {
                  avatarUrl: avatar_url !== undefined ? avatar_url ?? null : existing?.avatarUrl ?? null,
                  displayedBadgeIds:
                    existing?.displayedBadgeIds ?? readOwnDisplayedBadgeIds() ?? [],
                  badges: existing?.badges ?? [],
                  username: username ?? existing?.username ?? null,
                  displayName: nextUsername ?? existing?.displayName ?? null,
                  createdAt: existing?.createdAt ?? null,
                  membership:
                    existing?.membership ??
                    (viewer.isAdmin ? 'admin' : viewer.hasPremium ? 'pro' : 'free'),
                },
              };
            });
          }
        }}
      />

      <main
        className="dashboard-container h-full overflow-hidden px-0 transition-[margin,width] duration-300"
        style={{
          marginLeft: sidebarOpen ? 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))' : '0px',
          width: sidebarOpen ? 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))' : '100%',
          paddingLeft: 0,
        }}
      >
        <div className="mx-auto h-full w-full max-w-[1550px]" style={{ paddingLeft: 0, paddingRight: '0px' }}>
          <div
            className="dashboard-container flex h-full min-h-0 w-full flex-col px-1.5 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2 sm:px-3 sm:pt-4 lg:px-3 lg:pb-4"
          >
          {viewer.loading || !canChat ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-[#0f1a2b] dark:text-gray-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your chat access...
              </div>
            </div>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col sm:h-[calc(100dvh-9rem)] lg:h-[calc(100vh-1rem)] lg:max-w-[1480px] lg:pr-3">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent dark:bg-transparent lg:h-full lg:rounded-3xl lg:border lg:border-gray-200 lg:bg-white lg:shadow-sm dark:lg:border-gray-700 dark:lg:bg-[#0f1a2b]">
                <div className="border-b border-gray-200 px-2 py-3 dark:border-gray-700 sm:px-5 sm:py-4">
                  {loadingRooms ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading rooms...
                    </div>
                  ) : roomError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
                      {roomError}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <BackToPropsButton className="mb-1" />
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Community Chat
                              </h2>
                              {viewer.isAdmin && onlineCount ? (
                                <span
                                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                                  title="People on StatTrackr right now"
                                >
                                  <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                  </span>
                                  {onlineCount} online
                                </span>
                              ) : null}
                            </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Discuss bets, share slips, talk through plays, and hang out with the community.
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {pinnedMessages.length > 0 ? (
                            <button
                              type="button"
                              onClick={scrollToPinnedMessages}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-purple-400/50 bg-purple-500/15 px-2.5 py-1 text-[11px] font-semibold text-purple-700 transition-colors hover:bg-purple-500/25 dark:text-purple-200 sm:hidden"
                              aria-label={`View ${pinnedMessages.length} pinned chat ${pinnedMessages.length === 1 ? 'message' : 'messages'}`}
                            >
                              <Pin className="h-3 w-3" />
                              {pinnedMessages.length}+ pinned
                            </button>
                          ) : null}
                        </div>
                      </div>
                      </div>
                      {rooms.length > 1 ? (
                        <div className="flex rounded-2xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-[#111827]">
                          {rooms.map((room) => {
                            const isSelected = room.id === selectedRoomId;
                            const label = room.slug === 'general' ? 'Community' : room.name;
                            const unreadCount = roomUnreadCounts[room.id] ?? 0;
                            const unreadLabel = unreadCount > 9 ? '9+' : unreadCount.toString();

                            return (
                              <button
                                key={room.id}
                                type="button"
                                onClick={() => handleSelectRoom(room.id)}
                                className={`relative flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                                  isSelected
                                    ? 'bg-purple-600 text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-white/70 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white'
                                }`}
                              >
                                {label}
                                {unreadCount > 0 ? (
                                  <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-white dark:ring-[#111827]">
                                    {unreadLabel}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div
                  ref={messageListRef}
                  onScroll={handleMessageListScroll}
                  className="chat-scrollbar relative z-0 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-5 py-4"
                >
                  {loadingMessages ? (
                    <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading messages...
                    </div>
                  ) : threadError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
                      {threadError}
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                      <MessageSquareText className="h-8 w-8 text-purple-500" />
                      <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">
                        No messages yet
                      </h3>
                      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
                        Start the conversation!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {pinnedMessages.length > 0 ? (
                        <div
                          id="chat-pinned-messages"
                          className="rounded-2xl border border-purple-200 bg-purple-50/80 p-3 text-sm text-purple-800 dark:border-purple-800/60 dark:bg-purple-950/25 dark:text-purple-100"
                        >
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-purple-600 dark:text-purple-300">
                            <Pin className="h-3.5 w-3.5" />
                            Pinned
                          </div>
                          <div className="space-y-2">
                            {pinnedMessages.map((message) => (
                              <button
                                key={message.id}
                                type="button"
                                onClick={() => scrollToMessage(message.id)}
                                className="block w-full rounded-xl bg-white/80 px-3 py-2 text-left transition-colors hover:bg-white dark:bg-[#111c2d]/80 dark:hover:bg-[#162338]"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 truncate text-xs font-semibold">
                                    {message.display_name || 'Member'}
                                  </span>
                                  <span className="shrink-0 text-[11px] text-purple-500 dark:text-purple-300">
                                    {formatMessageTime(message.created_at)}
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-xs text-gray-700 dark:text-gray-200">{message.body || (message.image_url ? 'Photo' : '')}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {timelineItems.map((item) => {
                        if (item.type === 'divider') {
                          return (
                            <div key={item.key} className="flex items-center gap-3 py-2">
                              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                                {item.label}
                              </span>
                              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                            </div>
                          );
                        }

                        const { message } = item;
                        const isOwnMessage = message.user_id === viewer.userId;
                        const canDeleteMessage = isOwnMessage || viewer.isAdmin;
                        const isPinned = Boolean(message.pinned_at);
                        const isConfirmingDelete = confirmDeleteMessageId === message.id;
                        const isEditingMessage = editingMessageId === message.id;
                        const isEditedMessage = Boolean(message.edited_at);
                        const authorName = message.display_name || 'Member';
                        const memberProfile = memberProfiles[message.user_id];
                        const liveAvatarUrl = memberProfile?.avatarUrl ?? message.avatar_url;
                        const authorBadgeIds = memberProfile?.displayedBadgeIds ?? [];
                        const authorBadges = displayBadgesFromIds(authorBadgeIds);
                        const messageReactions = reactionsByMessage.get(message.id) ?? [];
                        const repliedToMessage = message.reply_to_message_id
                          ? messages.find((entry) => entry.id === message.reply_to_message_id) ?? null
                          : null;

                        return (
                          <div
                            id={`chat-message-${message.id}`}
                            key={item.key}
                            className={`group flex gap-3 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                          >
                            {!isOwnMessage && (
                              <ChatAvatar
                                name={authorName}
                                avatarUrl={liveAvatarUrl}
                                onClick={() => openMemberProfile(message.user_id, authorName, liveAvatarUrl)}
                              />
                            )}
                            <div className={isEditingMessage ? 'w-[92%] max-w-[720px] sm:w-[78%]' : 'max-w-[76%] sm:max-w-[78%]'}>
                              <div
                                className={`rounded-2xl px-2.5 py-1.5 sm:px-3 sm:py-2 ${
                                  isOwnMessage
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-gray-100 text-gray-900 dark:bg-[#162338] dark:text-white'
                                }`}
                              >
                                {repliedToMessage ? (
                                  <div
                                    className={`mb-2 rounded-xl border-l-2 px-2 py-1.5 text-left ${
                                      isOwnMessage
                                        ? 'border-slate-300/70 bg-slate-900/35'
                                        : 'border-purple-500 bg-white/40 dark:bg-white/5'
                                    }`}
                                  >
                                    <div className={`text-[11px] font-semibold ${isOwnMessage ? 'text-slate-100' : 'text-purple-600 dark:text-purple-300'}`}>
                                      Replying to {repliedToMessage.display_name || 'Member'}
                                    </div>
                                    <p className={`mt-0.5 line-clamp-2 text-xs ${isOwnMessage ? 'text-slate-200' : 'text-gray-600 dark:text-gray-300'}`}>
                                      {repliedToMessage.body || (repliedToMessage.image_url ? 'Photo' : '')}
                                    </p>
                                  </div>
                                ) : null}

                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openMemberProfile(message.user_id, authorName, liveAvatarUrl)}
                                    className={`text-[13px] font-semibold transition-opacity hover:opacity-80 ${
                                      isOwnMessage ? 'text-white' : 'text-gray-900 dark:text-white'
                                    }`}
                                  >
                                    {authorName}
                                  </button>
                                  {authorBadgeIds.length > 0 ? (
                                    <BadgeStrip
                                      badges={authorBadges}
                                      selectedIds={authorBadgeIds}
                                      className="shrink-0"
                                    />
                                  ) : null}
                                  <span className={`text-xs ${isOwnMessage ? 'text-purple-100' : 'text-gray-500 dark:text-gray-400'}`}>
                                    {formatMessageTime(message.created_at)}
                                  </span>
                                  {isPinned ? (
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                        isOwnMessage
                                          ? 'bg-white/15 text-purple-50'
                                          : 'bg-purple-100 text-purple-700 dark:bg-purple-900/35 dark:text-purple-200'
                                      }`}
                                    >
                                      <Pin className="h-3 w-3" />
                                      Pinned
                                    </span>
                                  ) : null}
                                </div>
                                {isEditingMessage ? (
                                  <div className="mt-2 space-y-2">
                                    <textarea
                                      value={editingMessageValue}
                                      onChange={(event) => {
                                        setEditingMessageValue(event.target.value);
                                        if (composerError) {
                                          setComposerError(null);
                                        }
                                      }}
                                      maxLength={CHAT_MAX_MESSAGE_LENGTH}
                                      rows={5}
                                      className="min-h-[132px] w-full resize-y rounded-xl border border-purple-300 bg-white px-3 py-2 text-[13px] leading-5 text-gray-900 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/25 dark:border-purple-700 dark:bg-[#111c2d] dark:text-white"
                                    />
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      <span className={`mr-auto text-[11px] ${isOwnMessage ? 'text-purple-100' : 'text-gray-500 dark:text-gray-400'}`}>
                                        {editingMessageValue.trim().length}/{CHAT_MAX_MESSAGE_LENGTH}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={cancelEditingMessage}
                                        disabled={savingEditMessageId === message.id}
                                        className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338]"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleSaveEditedMessage(message.id)}
                                        disabled={
                                          savingEditMessageId === message.id ||
                                          !editingMessageValue.trim() ||
                                          editingMessageValue.trim() === message.body
                                        }
                                        className="rounded-full bg-purple-700 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-purple-800 disabled:cursor-not-allowed disabled:bg-purple-400"
                                      >
                                        {savingEditMessageId === message.id ? 'Saving...' : 'Save'}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {message.image_url ? (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedImageUrl(message.image_url)}
                                        className="mt-1.5 block cursor-zoom-in"
                                        aria-label="Expand photo"
                                      >
                                        <img
                                          src={message.image_url}
                                          alt="Photo"
                                          onLoad={keepPinnedAfterImageLoad}
                                          className="max-h-80 w-auto max-w-full rounded-xl object-contain"
                                        />
                                      </button>
                                    ) : null}
                                    {message.body ? (
                                      <p className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug ${isOwnMessage ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                                        {splitMentionSegments(message.body, knownMentionHandles).map((segment, index) => {
                                          if (segment.type === 'text') {
                                            return <span key={`t-${index}`}>{segment.value}</span>;
                                          }
                                          const mentioned = mentionHandleMap.get(segment.value.toLowerCase());
                                          return (
                                            <button
                                              key={`m-${index}-${segment.value}`}
                                              type="button"
                                              onClick={() => {
                                                if (!mentioned) return;
                                                openMemberProfile(
                                                  mentioned.userId,
                                                  mentioned.label,
                                                  mentioned.avatarUrl
                                                );
                                              }}
                                              className={`rounded px-0.5 font-semibold ${
                                                isOwnMessage
                                                  ? 'bg-white/20 text-white hover:bg-white/30'
                                                  : 'bg-purple-500/15 text-purple-700 hover:bg-purple-500/25 dark:bg-purple-400/15 dark:text-purple-200 dark:hover:bg-purple-400/25'
                                              }`}
                                            >
                                              @{segment.value}
                                            </button>
                                          );
                                        })}
                                      </p>
                                    ) : null}
                                    {isEditedMessage ? (
                                      <span className={`mt-1 block text-[10px] ${isOwnMessage ? 'text-purple-100/80' : 'text-gray-400 dark:text-gray-500'}`}>
                                        Edited
                                      </span>
                                    ) : null}
                                  </>
                                )}
                              </div>

                              {messageReactions.length > 0 && !isEditingMessage ? (
                                <div className="mt-2 flex flex-wrap justify-start gap-2.5">
                                  {messageReactions.map((reaction) => {
                                    const reactionKey = `${message.id}:${reaction.emoji}`;

                                    return (
                                      <button
                                        key={reaction.emoji}
                                        type="button"
                                        onClick={() => void handleToggleReaction(message.id, reaction.emoji)}
                                        disabled={togglingReactionKey === reactionKey}
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                          reaction.reacted
                                            ? 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-700/60 dark:bg-purple-900/20 dark:text-purple-200'
                                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338]'
                                        }`}
                                        aria-label={`Toggle ${reaction.emoji} reaction`}
                                      >
                                        <span className="text-base leading-none">{reaction.emoji}</span>
                                        <span>{reaction.count}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}

                              {!isEditingMessage ? (
                              <div
                                className={`mt-2 hidden lg:flex items-center gap-1 transition-opacity ${
                                  reactionPickerMessageId === message.id || isConfirmingDelete
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-100'
                                } ${isOwnMessage ? 'justify-start' : 'justify-end'}`}
                              >
                                {isConfirmingDelete ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteMessage(message.id)}
                                      disabled={deletingMessageId === message.id}
                                      className="flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-[#111c2d] dark:text-red-300 dark:hover:bg-red-950/20 dark:hover:text-red-200"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      {deletingMessageId === message.id ? 'Deleting...' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteMessageId(null)}
                                      disabled={deletingMessageId === message.id}
                                      className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      data-reaction-toggle
                                      onClick={() =>
                                        setReactionPickerMessageId((current) => (current === message.id ? null : message.id))
                                      }
                                      className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                      aria-label="Add reaction"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setReplyTargetId(message.id)}
                                      className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                    >
                                      <CornerUpLeft className="h-3 w-3" />
                                      Reply
                                    </button>
                                    {isOwnMessage ? (
                                      <button
                                        type="button"
                                        onClick={() => startEditingMessage(message)}
                                        className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                      >
                                        Edit
                                      </button>
                                    ) : null}
                                    {viewer.isAdmin ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleTogglePinMessage(message.id)}
                                        disabled={pinningMessageId === message.id}
                                        className="flex items-center gap-1 rounded-full border border-purple-200 bg-white px-2.5 py-1 text-[11px] font-medium text-purple-600 shadow-sm transition-colors hover:bg-purple-50 hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-purple-800/70 dark:bg-[#111c2d] dark:text-purple-300 dark:hover:bg-purple-950/20 dark:hover:text-purple-200"
                                      >
                                        <Pin className="h-3 w-3" />
                                        {pinningMessageId === message.id ? 'Saving...' : isPinned ? 'Unpin' : 'Pin'}
                                      </button>
                                    ) : null}
                                    {canDeleteMessage ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReactionPickerMessageId(null);
                                          setConfirmDeleteMessageId(message.id);
                                        }}
                                        disabled={deletingMessageId === message.id}
                                        className="flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-[#111c2d] dark:text-red-300 dark:hover:bg-red-950/20 dark:hover:text-red-200"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                        {isOwnMessage ? 'Delete' : 'Admin delete'}
                                      </button>
                                    ) : null}
                                  </>
                                )}
                              </div>
                              ) : null}

                              {reactionPickerMessageId === message.id && !isEditingMessage ? (
                                <div
                                  data-reaction-picker
                                  className={`mt-2 flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-[#111c2d] ${
                                    isOwnMessage ? 'justify-start' : 'justify-end'
                                  }`}
                                >
                                  {CHAT_REACTION_OPTIONS.map((emoji) => {
                                    const reactionKey = `${message.id}:${emoji}`;

                                    return (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => void handleToggleReaction(message.id, emoji)}
                                        disabled={togglingReactionKey === reactionKey}
                                        className="flex h-10 w-10 items-center justify-center rounded-xl text-[20px] transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#162338]"
                                        aria-label={`React with ${emoji}`}
                                      >
                                        {emoji}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}

                              {!isEditingMessage ? (
                                <div className="mt-2 lg:hidden">
                                  {isConfirmingDelete ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteMessage(message.id)}
                                        disabled={deletingMessageId === message.id}
                                        className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-[#111c2d] dark:text-red-300 dark:hover:bg-red-950/20 dark:hover:text-red-200"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                        {deletingMessageId === message.id ? 'Deleting...' : 'Confirm'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteMessageId(null)}
                                        disabled={deletingMessageId === message.id}
                                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        data-reaction-toggle
                                        onClick={() =>
                                          setReactionPickerMessageId((current) => (current === message.id ? null : message.id))
                                        }
                                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                        aria-label="Add reaction"
                                      >
                                        <Plus className="h-3 w-3" />
                                        React
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReactionPickerMessageId(null);
                                          setConfirmDeleteMessageId(null);
                                          setReplyTargetId(message.id);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                      >
                                        <CornerUpLeft className="h-3 w-3" />
                                        Reply
                                      </button>
                                      {isOwnMessage ? (
                                        <button
                                          type="button"
                                          onClick={() => startEditingMessage(message)}
                                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338] dark:hover:text-white"
                                        >
                                          Edit
                                        </button>
                                      ) : null}
                                      {viewer.isAdmin ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleTogglePinMessage(message.id)}
                                          disabled={pinningMessageId === message.id}
                                          className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-white px-2.5 py-1 text-[11px] font-medium text-purple-600 transition-colors hover:bg-purple-50 hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-purple-800/70 dark:bg-[#111c2d] dark:text-purple-300 dark:hover:bg-purple-950/20 dark:hover:text-purple-200"
                                        >
                                          <Pin className="h-3 w-3" />
                                          {pinningMessageId === message.id ? 'Saving...' : isPinned ? 'Unpin' : 'Pin'}
                                        </button>
                                      ) : null}
                                      {canDeleteMessage ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setReactionPickerMessageId(null);
                                            setConfirmDeleteMessageId(message.id);
                                          }}
                                          disabled={deletingMessageId === message.id}
                                          className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-[#111c2d] dark:text-red-300 dark:hover:bg-red-950/20 dark:hover:text-red-200"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                          {isOwnMessage ? 'Delete' : 'Admin delete'}
                                        </button>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                            {isOwnMessage && (
                              <ChatAvatar
                                name={authorName}
                                avatarUrl={liveAvatarUrl}
                                onClick={() => openMemberProfile(message.user_id, authorName, liveAvatarUrl)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t border-gray-200 px-5 pb-3 pt-1 dark:border-gray-700 sm:py-4">
                  <ChatComposer
                    ref={composerRef}
                    mentionCandidates={mentionCandidates}
                    knownMentionHandles={knownMentionHandles}
                    replyTarget={replyTarget}
                    onCancelReply={() => setReplyTargetId(null)}
                    onSend={submitMessage}
                    sending={sendingMessage}
                    disabled={!selectedRoomId || !canChat}
                    isAdmin={viewer.isAdmin}
                    composerImage={composerImage}
                    onPickImage={handlePickImage}
                    onClearImage={clearComposerImage}
                    error={composerError}
                    onClearError={() => setComposerError(null)}
                    isCooldown={isMessageCooldownActive}
                  />
                </div>
              </div>
            </section>
          )}
          </div>
        </div>
      </main>
      {expandedImageUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setExpandedImageUrl(null)}
          className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setExpandedImageUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            aria-label="Close photo"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={expandedImageUrl}
            alt="Photo"
            onClick={(event) => event.stopPropagation()}
            className="max-h-[90vh] max-w-[95vw] cursor-default rounded-xl object-contain shadow-2xl"
          />
        </div>
      ) : null}
      {profileCard ? (
        <ChatMemberProfileCard
          profile={profileCard}
          onClose={() => setProfileCard(null)}
          onMention={(username) => {
            composerRef.current?.insertMention(username);
            setProfileCard(null);
            composerRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}