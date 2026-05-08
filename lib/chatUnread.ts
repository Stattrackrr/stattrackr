'use client';

import { supabase } from '@/lib/supabaseClient';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const CHAT_LAST_READ_PREFIX = 'chat:last-read:';
const CHAT_UNREAD_SYNC_EVENT = 'chat-unread-sync';

function getChatLastReadKey(userId: string): string {
  return `${CHAT_LAST_READ_PREFIX}${userId}`;
}

function getChatLastRead(userId: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(getChatLastReadKey(userId));
  } catch {
    return null;
  }
}

export function markChatAsRead(userId: string, timestamp = new Date().toISOString()) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getChatLastReadKey(userId), timestamp);
    window.dispatchEvent(
      new CustomEvent(CHAT_UNREAD_SYNC_EVENT, {
        detail: { userId, timestamp },
      })
    );
  } catch {
    // Ignore storage access failures on restricted browsers.
  }
}

export function useChatUnread(enabled = true) {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;
      setUserId(user?.id ?? null);
    };

    void loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !userId) {
      setUnreadCount(0);
      return;
    }

    const isChatRoute = pathname?.startsWith('/chat');
    if (isChatRoute) {
      markChatAsRead(userId);
      setUnreadCount(0);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          markChatAsRead(userId);
        }
      };

      const intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          markChatAsRead(userId);
        }
      }, 5000);

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        window.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    let isMounted = true;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    const checkUnread = async () => {
      const lastReadAt = getChatLastRead(userId);

      try {
        let query = (supabase
          .from('chat_messages') as any)
          .select('id', { count: 'exact', head: true })
          .is('deleted_at', null);

        if (lastReadAt) {
          query = query.gt('created_at', lastReadAt);
        }

        const { count, error } = await query;

        if (!isMounted || error) {
          return;
        }

        setUnreadCount(count ?? 0);
      } catch {
        if (isMounted) {
          setUnreadCount(0);
        }
      }
    };

    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== userId) {
        return;
      }

      void checkUnread();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkUnread();
      }
    };

    void checkUnread();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void checkUnread();
    }, 5000);

    try {
      realtimeChannel = supabase
        .channel(`chat-unread:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
          },
          () => {
            void checkUnread();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'chat_messages',
          },
          () => {
            void checkUnread();
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            void checkUnread();
          }
        });
    } catch {
      // Realtime can fail in some local or mobile browser setups, so polling stays as the fallback.
    }

    window.addEventListener(CHAT_UNREAD_SYNC_EVENT, handleSync as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
      window.removeEventListener(CHAT_UNREAD_SYNC_EVENT, handleSync as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, pathname, userId]);

  return unreadCount;
}
