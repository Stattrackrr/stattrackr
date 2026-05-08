'use client';

import { DashboardLeftSidebarWrapper } from '@/app/nba/research/dashboard/components/DashboardLeftSidebarWrapper';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { useTheme } from '@/contexts/ThemeContext';
import {
  CHAT_MAX_MESSAGE_LENGTH,
  ChatMessage,
  ChatRoom,
  fetchChatMessages,
  fetchChatRooms,
  sendChatMessage,
} from '@/lib/chat';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerUpLeft, Loader2, MessageSquareText, Send, X } from 'lucide-react';

type OddsFormat = 'american' | 'decimal';

type ViewerState = {
  userId: string | null;
  username: string | null;
  userEmail: string | null;
  avatarUrl: string | null;
  hasPremium: boolean;
  loading: boolean;
};

const DEFAULT_VIEWER: ViewerState = {
  userId: null,
  username: null,
  userEmail: null,
  avatarUrl: null,
  hasPremium: false,
  loading: true,
};

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messageMap = new Map<string, ChatMessage>();

  for (const message of current) {
    messageMap.set(message.id, message);
  }

  for (const message of incoming) {
    messageMap.set(message.id, message);
  }

  return Array.from(messageMap.values()).sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
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
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

export default function ChatPageClient() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const [viewer, setViewer] = useState<ViewerState>(DEFAULT_VIEWER);
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('american');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);

  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId]
  );
  const replyTarget = useMemo(
    () => messages.find((message) => message.id === replyTargetId) ?? null,
    [messages, replyTargetId]
  );

  const loadMessages = useCallback(
    async (roomId: string, options?: { silent?: boolean; preserveError?: boolean }) => {
      const { silent = false, preserveError = false } = options ?? {};

      if (!silent) {
        setLoadingMessages(true);
      }
      if (!preserveError) {
        setMessageError(null);
      }

      try {
        const loadedMessages = await fetchChatMessages(roomId);
        setMessages((current) => mergeMessages(current, loadedMessages));
        return loadedMessages;
      } catch (error) {
        console.error('Chat page: failed to load messages', error);
        setMessageError('Unable to load messages for this room.');
        return null;
      } finally {
        if (!silent) {
          setLoadingMessages(false);
        }
      }
    },
    []
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
          hasPremium: Boolean(isActive && premiumTier),
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
          hasPremium: false,
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
      setReplyTargetId(null);
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
    if (!viewer.hasPremium || !selectedRoomId) return;

    const channel = supabase
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
            return [...current, nextMessage];
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
          setMessages((current) =>
            nextMessage.deleted_at
              ? current.filter((message) => message.id !== nextMessage.id)
              : current.map((message) => (message.id === nextMessage.id ? nextMessage : message))
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedRoomId, viewer.hasPremium]);

  useEffect(() => {
    if (!viewer.hasPremium || !selectedRoomId) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadMessages(selectedRoomId, { silent: true, preserveError: true });
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadMessages, selectedRoomId, viewer.hasPremium]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [messages, selectedRoomId]);

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

  const submitMessage = useCallback(async () => {
    if (!selectedRoomId || !viewer.hasPremium || sendingMessage) {
      return;
    }

    const trimmedMessage = composerValue.trim();
    if (!trimmedMessage) {
      return;
    }

    if (trimmedMessage.length > CHAT_MAX_MESSAGE_LENGTH) {
      setMessageError(`Messages must be ${CHAT_MAX_MESSAGE_LENGTH} characters or less.`);
      return;
    }

    setSendingMessage(true);
    setMessageError(null);

    try {
      const createdMessage = await sendChatMessage(selectedRoomId, trimmedMessage, replyTargetId);
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
      console.error('Chat page: failed to send message', error);
      const fallbackError = 'Unable to send your message right now.';
      setMessageError(error instanceof Error ? error.message || fallbackError : fallbackError);
    } finally {
      setSendingMessage(false);
    }
  }, [composerValue, loadMessages, replyTargetId, selectedRoomId, sendingMessage, viewer.hasPremium]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitMessage();
  };

  const handleComposerKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await submitMessage();
  };

  return (
    <div className="dashboard-container min-h-screen bg-gray-50 dark:bg-[#050d1a] text-gray-900 dark:text-white transition-colors lg:overflow-x-auto lg:overflow-y-hidden">
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
          setViewer((current) => ({
            ...current,
            username: username ?? full_name ?? current.username,
            avatarUrl: avatar_url ?? current.avatarUrl,
          }));
        }}
      />

      <main
        className="dashboard-container px-0 transition-[margin,width] duration-300"
        style={{
          marginLeft: sidebarOpen ? 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))' : '0px',
          width: sidebarOpen ? 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))' : '100%',
          paddingLeft: 0,
        }}
      >
        <div className="mx-auto w-full max-w-[1550px]" style={{ paddingLeft: 0, paddingRight: '0px' }}>
          <div className="dashboard-container flex min-h-screen w-full flex-col px-4 pb-28 pt-4 lg:pb-4">
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
            <section className="flex min-h-0 flex-1 flex-col lg:h-[calc(100vh-1rem)] lg:max-w-[1480px] lg:pr-4">
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
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Community Chat</h2>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Discuss bets, share slips, talk through plays, and hang out with the community.
                          </p>
                        </div>
                        <div className="text-xs uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                          {messages.length} message{messages.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div ref={messageListRef} className="flex-1 overflow-y-auto px-5 py-4">
                  {loadingMessages ? (
                    <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading messages...
                    </div>
                  ) : messageError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
                      {messageError}
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 px-6 text-center dark:border-gray-700">
                      <MessageSquareText className="h-8 w-8 text-purple-500" />
                      <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">No messages yet</h3>
                      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
                        Start the conversation and your message will appear live for other members.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {messages.map((message) => {
                        const isOwnMessage = message.user_id === viewer.userId;
                        const authorName = message.display_name || 'Member';
                        const repliedToMessage = message.reply_to_message_id
                          ? messages.find((entry) => entry.id === message.reply_to_message_id) ?? null
                          : null;

                        return (
                          <div
                            key={message.id}
                            className={`group flex gap-3 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                          >
                            {!isOwnMessage && <ChatAvatar name={authorName} avatarUrl={message.avatar_url} />}
                            <div className="relative max-w-[76%] sm:max-w-[78%]">
                              <button
                                type="button"
                                onClick={() => setReplyTargetId(message.id)}
                                className={`absolute -top-3 hidden lg:flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 ${
                                  isOwnMessage ? 'left-0' : 'right-0'
                                }`}
                              >
                                <CornerUpLeft className="h-3 w-3" />
                                Reply
                              </button>

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
                                </div>
                                <p className={`mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 ${isOwnMessage ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                                  {message.body}
                                </p>
                              </div>
                            </div>
                            {isOwnMessage && <ChatAvatar name={authorName} avatarUrl={message.avatar_url} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-700">
                  <form onSubmit={handleSubmit} className="space-y-3">
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
                    <textarea
                      value={composerValue}
                      onChange={(event) => {
                        setComposerValue(event.target.value);
                        if (messageError) {
                          setMessageError(null);
                        }
                      }}
                      onKeyDown={handleComposerKeyDown}
                      placeholder="Share something with the community..."
                      maxLength={CHAT_MAX_MESSAGE_LENGTH}
                      rows={3}
                      className="w-full resize-none rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500/25 dark:border-gray-600 dark:bg-[#111c2d] dark:text-white"
                    />
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="order-2 text-xs text-gray-500 dark:text-gray-400 sm:order-1">
                        {composerValue.trim().length}/{CHAT_MAX_MESSAGE_LENGTH} characters
                      </div>
                      <div className="order-1 flex items-center gap-3 sm:order-2">
                        {messageError ? (
                          <span className="text-xs text-red-600 dark:text-red-300">{messageError}</span>
                        ) : null}
                        <button
                          type="submit"
                          disabled={!selectedRoomId || !composerValue.trim() || sendingMessage}
                          className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-400"
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
    </div>
  );
}
