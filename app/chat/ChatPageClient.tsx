'use client';

import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { useTheme } from '@/contexts/ThemeContext';
import {
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
} from '@/lib/chat';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { ClipboardEvent, FormEvent, KeyboardEvent, UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerUpLeft, Loader2, MessageSquareText, Pin, Plus, Send, Trash2, X } from 'lucide-react';

type OddsFormat = 'american' | 'decimal';
const CHAT_ADMIN_EMAIL = 'admin@stattrackr.co';

type ViewerState = {
  userId: string | null;
  username: string | null;
  userEmail: string | null;
  avatarUrl: string | null;
  hasPremium: boolean;
  isAdmin: boolean;
  loading: boolean;
};

const DEFAULT_VIEWER: ViewerState = {
  userId: null,
  username: null,
  userEmail: null,
  avatarUrl: null,
  hasPremium: false,
  isAdmin: false,
  loading: true,
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
}: {
  name: string;
  avatarUrl: string | null;
  size?: 'sm' | 'md';
}) {
  const dimension = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  const initial = name.trim().charAt(0).toUpperCase() || 'C';

  return (
    <div
      className={`${dimension} rounded-full overflow-hidden flex items-center justify-center font-semibold text-white shrink-0`}
      style={avatarUrl ? undefined : { backgroundColor: getAvatarColor(name) }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

function moveCaretToEnd(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export default function ChatPageClient() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const [viewer, setViewer] = useState<ViewerState>(DEFAULT_VIEWER);
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('american');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
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
  const [composerValue, setComposerValue] = useState('');
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [mobileKeyboardOpen, setMobileKeyboardOpen] = useState(false);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);

  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const mobileComposerRef = useRef<HTMLDivElement>(null);
  const messageCooldownTimeoutRef = useRef<number | null>(null);
  const mobileViewportHeightRef = useRef<number | null>(null);
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
  const pinnedMessages = useMemo(
    () =>
      messages
        .filter((message) => message.pinned_at)
        .sort((left, right) => new Date(right.pinned_at ?? 0).getTime() - new Date(left.pinned_at ?? 0).getTime()),
    [messages]
  );
  const isMessageCooldownActive = Boolean(messageCooldownUntil && messageCooldownUntil > Date.now());
  const shouldHideMobileNavigation = composerFocused || mobileKeyboardOpen;
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
      const storedOddsFormat = window.localStorage.getItem('oddsFormat');
      if (storedOddsFormat === 'american' || storedOddsFormat === 'decimal') {
        setOddsFormat(storedOddsFormat);
      }
    } catch {
      // Ignore local storage access issues.
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadViewer = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace('/login?redirect=/chat');
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, username, avatar_url, subscription_status, subscription_tier')
          .eq('id', session.user.id)
          .single();

        if (!isMounted) return;

        const profileData = profile as {
          full_name?: string | null;
          username?: string | null;
          avatar_url?: string | null;
          subscription_status?: string | null;
          subscription_tier?: string | null;
        } | null;

        const isActive =
          profileData?.subscription_status === 'active' || profileData?.subscription_status === 'trialing';
        const premiumTier =
          profileData?.subscription_tier === 'premium' || profileData?.subscription_tier === 'pro';
        const isAdmin = (session.user.email ?? '').toLowerCase() === CHAT_ADMIN_EMAIL;

        setViewer({
          userId: session.user.id,
          userEmail: session.user.email ?? null,
          username:
            profileData?.username ||
            profileData?.full_name ||
            session.user.user_metadata?.username ||
            session.user.user_metadata?.full_name ||
            null,
          avatarUrl:
            profileData?.avatar_url ??
            session.user.user_metadata?.avatar_url ??
            session.user.user_metadata?.picture ??
            null,
          hasPremium: Boolean((isActive && premiumTier) || isAdmin),
          isAdmin,
          loading: false,
        });
      } catch (error) {
        if (!isMounted) return;
        console.error('Chat page: failed to load viewer profile', error);
        setViewer({
          userId: session.user.id,
          userEmail: session.user.email ?? null,
          username:
            session.user.user_metadata?.username ||
            session.user.user_metadata?.full_name ||
            session.user.email ||
            null,
          avatarUrl:
            session.user.user_metadata?.avatar_url ??
            session.user.user_metadata?.picture ??
            null,
          hasPremium: (session.user.email ?? '').toLowerCase() === CHAT_ADMIN_EMAIL,
          isAdmin: (session.user.email ?? '').toLowerCase() === CHAT_ADMIN_EMAIL,
          loading: false,
        });
      }
    };

    void loadViewer();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setViewer(DEFAULT_VIEWER);
        router.replace('/login?redirect=/chat');
      }

      if (event === 'SIGNED_IN' && session?.user) {
        void loadViewer();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (viewer.loading || !viewer.hasPremium) return;

    let isMounted = true;
    setLoadingRooms(true);
    setRoomError(null);

    fetchChatRooms()
      .then((loadedRooms) => {
        if (!isMounted) return;
        setRooms(loadedRooms);
        setSelectedRoomId((currentRoomId) => {
          if (currentRoomId && loadedRooms.some((room) => room.id === currentRoomId)) {
            return currentRoomId;
          }
          return loadedRooms.find((room) => room.slug === 'general')?.id ?? loadedRooms[0]?.id ?? null;
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
  }, [viewer.hasPremium, viewer.loading]);

  useEffect(() => {
    if (!viewer.hasPremium || !selectedRoomId) {
      setMessages([]);
      setReactions([]);
      setReplyTargetId(null);
      setReactionPickerMessageId(null);
      return;
    }

    let isMounted = true;
    void loadMessages(selectedRoomId).then(() => {
      if (!isMounted) return;
    });

    return () => {
      isMounted = false;
    };
  }, [loadMessages, selectedRoomId, viewer.hasPremium]);

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
    if (composerValue === '' && mobileComposerRef.current) {
      mobileComposerRef.current.textContent = '';
    }
  }, [composerValue]);

  useEffect(() => {
    const getViewportHeight = () => window.visualViewport?.height ?? window.innerHeight;

    const updateMobileKeyboardState = () => {
      const viewportHeight = getViewportHeight();
      const baselineHeight = mobileViewportHeightRef.current ?? viewportHeight;
      mobileViewportHeightRef.current = Math.max(baselineHeight, viewportHeight);
      setMobileKeyboardOpen(mobileViewportHeightRef.current - viewportHeight > 140);
    };

    updateMobileKeyboardState();

    window.visualViewport?.addEventListener('resize', updateMobileKeyboardState);
    window.addEventListener('resize', updateMobileKeyboardState);
    window.addEventListener('orientationchange', updateMobileKeyboardState);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateMobileKeyboardState);
      window.removeEventListener('resize', updateMobileKeyboardState);
      window.removeEventListener('orientationchange', updateMobileKeyboardState);
    };
  }, []);

  useEffect(() => {
    if (!viewer.hasPremium || !selectedRoomId) return;

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
  }, [selectedRoomId, viewer.hasPremium]);

  useEffect(() => {
    if (!viewer.hasPremium || !selectedRoomId) return;

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
  }, [loadMessages, selectedRoomId, viewer.hasPremium]);

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

  const submitMessage = useCallback(async () => {
    if (!selectedRoomId || !viewer.hasPremium || sendingMessage) {
      return;
    }

    if (messageCooldownUntil && messageCooldownUntil > Date.now()) {
      setComposerError(MESSAGE_COOLDOWN_TEXT);
      return;
    }

    if (messageCooldownUntil) {
      setMessageCooldownUntil(null);
    }

    const trimmedMessage = composerValue.trim();
    if (!trimmedMessage) {
      return;
    }

    if (trimmedMessage.length > CHAT_MAX_MESSAGE_LENGTH) {
      setComposerError(`Messages must be ${CHAT_MAX_MESSAGE_LENGTH} characters or less.`);
      return;
    }

    setSendingMessage(true);
    setComposerError(null);

    try {
      const createdMessage = await sendChatMessage(selectedRoomId, trimmedMessage, replyTargetId);
      shouldScrollToBottomRef.current = true;
      setMessages((current) => {
        if (current.some((message) => message.id === createdMessage.id)) {
          return current;
        }
        return [...current, createdMessage];
      });
      setComposerValue('');
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
    composerValue,
    loadMessages,
    messageCooldownUntil,
    replyTargetId,
    selectedRoomId,
    sendingMessage,
    startMessageCooldown,
    viewer.hasPremium,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitMessage();
  };

  const handleComposerKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await submitMessage();
  };

  const handleMobileComposerInput = useCallback(
    (event: FormEvent<HTMLDivElement>) => {
      const nextValue = event.currentTarget.innerText.replace(/\u00a0/g, ' ');
      const limitedValue = nextValue.slice(0, CHAT_MAX_MESSAGE_LENGTH);

      if (nextValue !== limitedValue) {
        event.currentTarget.innerText = limitedValue;
        moveCaretToEnd(event.currentTarget);
      }

      setComposerValue(limitedValue);
      if (composerError) {
        setComposerError(null);
      }
    },
    [composerError]
  );

  const handleMobileComposerPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();

    const pastedText = event.clipboardData.getData('text/plain');
    if (!pastedText) return;

    document.execCommand('insertText', false, pastedText.slice(0, CHAT_MAX_MESSAGE_LENGTH));
  }, []);

  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!viewer.userId || !viewer.hasPremium || togglingReactionKey) {
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
    [messages, refreshReactions, togglingReactionKey, viewer.hasPremium, viewer.userId]
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
    <div className="dashboard-container fixed inset-0 h-[100dvh] overflow-hidden bg-gray-50 text-gray-900 transition-colors dark:bg-[#050d1a] dark:text-white">
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

        .chat-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(168, 85, 247, 0.65) transparent;
        }

        .chat-scrollbar::-webkit-scrollbar {
          width: 10px;
        }

        .chat-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }

        .chat-scrollbar::-webkit-scrollbar-thumb {
          border-radius: 9999px;
          border: 2px solid transparent;
          background-clip: padding-box;
          background-color: rgba(148, 163, 184, 0.38);
        }

        .chat-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(168, 85, 247, 0.68);
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
          setViewer((current) => ({
            ...current,
            username: username ?? full_name ?? current.username,
            avatarUrl: avatar_url ?? current.avatarUrl,
          }));
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
            className={`dashboard-container flex h-full min-h-0 w-full flex-col px-1.5 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-3 sm:pt-4 lg:px-3 lg:pb-4 ${
              mobileKeyboardOpen ? 'pb-2' : 'pb-24'
            }`}
          >
          {viewer.loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-[#0f1a2b] dark:text-gray-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your chat access...
              </div>
            </div>
          ) : !viewer.hasPremium ? (
            <div className="rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-6 shadow-sm dark:border-purple-800/60 dark:from-purple-950/30 dark:to-[#0f1a2b]">
              <div className="max-w-2xl">
                <p className="text-sm font-medium uppercase tracking-[0.22em] text-purple-500 dark:text-purple-300">
                  Upgrade required
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
                  Chat is available to premium members.
                </h2>
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  Upgrade to unlock the live community feed, picks room, and in-app conversation from both desktop and mobile nav.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => router.push('/subscription')}
                    className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                  >
                    View plans
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/props')}
                    className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    Back to props
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col sm:h-[calc(100dvh-9rem)] lg:h-[calc(100vh-1rem)] lg:max-w-[1480px] lg:pr-3">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-[#0f1a2b] lg:h-full">
                <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
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
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Community Chat</h2>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Discuss bets, share slips, talk through plays, and hang out with the community.
                          </p>
                        </div>
                        {pinnedMessages.length > 0 ? (
                          <button
                            type="button"
                            onClick={scrollToPinnedMessages}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-purple-400/50 bg-purple-500/15 px-2.5 py-1 text-[11px] font-semibold text-purple-200 transition-colors hover:bg-purple-500/25 sm:hidden"
                            aria-label={`View ${pinnedMessages.length} pinned chat ${pinnedMessages.length === 1 ? 'message' : 'messages'}`}
                          >
                            <Pin className="h-3 w-3" />
                            {pinnedMessages.length}+ pinned
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  ref={messageListRef}
                  onScroll={handleMessageListScroll}
                  className="chat-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4"
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
                      <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">No messages yet</h3>
                      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
                        Start the conversation!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
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
                                <p className="mt-1 line-clamp-2 text-xs text-gray-700 dark:text-gray-200">{message.body}</p>
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
                            {!isOwnMessage && <ChatAvatar name={authorName} avatarUrl={message.avatar_url} />}
                            <div className={isEditingMessage ? 'w-[92%] max-w-[720px] sm:w-[78%]' : 'max-w-[76%] sm:max-w-[78%]'}>
                              <div
                                className={`rounded-2xl px-2.5 py-2 sm:px-3 sm:py-2.5 ${
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
                                      {repliedToMessage.body}
                                    </p>
                                  </div>
                                ) : null}

                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`text-[13px] font-semibold ${isOwnMessage ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
                                    {authorName}
                                  </span>
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
                                    <p className={`mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 ${isOwnMessage ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                                      {message.body}
                                    </p>
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
                            {isOwnMessage && <ChatAvatar name={authorName} avatarUrl={message.avatar_url} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 px-5 pb-3 pt-1 dark:border-gray-700 sm:py-4">
                  <form onSubmit={handleSubmit} className="space-y-1 sm:space-y-3">
                    {replyTarget ? (
                      <div className="flex items-start justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-[#111c2d]">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-purple-600 dark:text-purple-300">
                            Replying to {replyTarget.display_name || 'Member'}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-300">
                            {replyTarget.body}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReplyTargetId(null)}
                          className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                          aria-label="Cancel reply"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                    <div className="relative translate-y-2 sm:translate-y-0">
                      <div
                        ref={mobileComposerRef}
                        contentEditable
                        role="textbox"
                        aria-label="Message"
                        aria-multiline="true"
                        tabIndex={0}
                        onInput={handleMobileComposerInput}
                        onPaste={handleMobileComposerPaste}
                        onKeyDown={handleComposerKeyDown}
                        onFocus={() => setComposerFocused(true)}
                        onBlur={() => setComposerFocused(false)}
                        className="chat-scrollbar h-16 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-gray-300 bg-white px-4 py-2.5 pr-20 text-sm text-gray-900 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500/25 dark:border-gray-600 dark:bg-[#111c2d] dark:text-white sm:hidden"
                      />
                      {!composerValue ? (
                        <span className="pointer-events-none absolute left-4 top-2.5 text-sm text-gray-500 dark:text-gray-400 sm:hidden">
                          Message...
                        </span>
                      ) : null}
                      <textarea
                        value={composerValue}
                        onChange={(event) => {
                          setComposerValue(event.target.value);
                          if (composerError) {
                            setComposerError(null);
                          }
                        }}
                        onKeyDown={handleComposerKeyDown}
                        onFocus={() => setComposerFocused(true)}
                        onBlur={() => setComposerFocused(false)}
                        placeholder="Message..."
                        maxLength={CHAT_MAX_MESSAGE_LENGTH}
                        rows={3}
                        className="hidden h-16 w-full resize-none rounded-2xl border border-gray-300 bg-white px-4 py-2.5 pr-20 text-sm text-gray-900 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500/25 dark:border-gray-600 dark:bg-[#111c2d] dark:text-white sm:block sm:h-auto sm:py-3 sm:pr-4"
                      />
                      <button
                        type="submit"
                        disabled={!selectedRoomId || !composerValue.trim() || sendingMessage || isMessageCooldownActive}
                        className="absolute bottom-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-400 sm:hidden"
                        aria-label="Send message"
                      >
                        {sendingMessage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <div className="order-2 text-[10px] leading-none text-gray-500 dark:text-gray-400 sm:order-1 sm:text-xs sm:leading-normal">
                        {composerValue.trim().length}/{CHAT_MAX_MESSAGE_LENGTH} characters
                      </div>
                      <div className="order-1 flex items-center gap-3 sm:order-2">
                        {composerError ? (
                          <span className="text-xs text-red-600 dark:text-red-300">{composerError}</span>
                        ) : null}
                        <button
                          type="submit"
                          disabled={!selectedRoomId || !composerValue.trim() || sendingMessage || isMessageCooldownActive}
                          className="hidden items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-400 sm:inline-flex"
                        >
                          {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Send message
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            </section>
          )}
          </div>
        </div>
      </main>

      {!shouldHideMobileNavigation ? (
        <MobileBottomNavigation
          hasPremium={viewer.hasPremium}
          username={viewer.username}
          userEmail={viewer.userEmail}
          avatarUrl={viewer.avatarUrl}
          showJournalDropdown={showJournalDropdown}
          showProfileDropdown={showProfileDropdown}
          showSettingsDropdown={showSettingsDropdown}
          setShowJournalDropdown={setShowJournalDropdown}
          setShowProfileDropdown={setShowProfileDropdown}
          setShowSettingsDropdown={setShowSettingsDropdown}
          profileDropdownRef={profileDropdownRef}
          journalDropdownRef={journalDropdownRef}
          settingsDropdownRef={settingsDropdownRef}
          onProfileClick={() => window.dispatchEvent(new CustomEvent('open-profile-modal'))}
          onSubscription={handleSubscriptionClick}
          onLogout={handleLogout}
          theme={theme}
          oddsFormat={oddsFormat}
          setTheme={setTheme}
          setOddsFormat={(nextFormat) => {
            setOddsFormat(nextFormat);
            try {
              window.localStorage.setItem('oddsFormat', nextFormat);
            } catch {
              // Ignore local storage access issues.
            }
          }}
        />
      ) : null}
    </div>
  );
}
