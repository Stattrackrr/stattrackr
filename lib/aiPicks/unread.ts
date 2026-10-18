'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const PICKS_LAST_READ_PREFIX = 'picks:last-read:';
const PICKS_UNREAD_SYNC_EVENT = 'picks-unread-sync';
const PICKS_POLL_MS = 60_000;
/** First visit: only the last day of picks counts as new, not the whole history. */
const FIRST_VISIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function lastReadKey(userId: string): string {
  return `${PICKS_LAST_READ_PREFIX}${userId}`;
}

function getPicksLastRead(userId: string): string | null {
  try {
    return window.localStorage.getItem(lastReadKey(userId));
  } catch {
    return null;
  }
}

export function markPicksAsRead(userId: string, timestamp = new Date().toISOString()) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lastReadKey(userId), timestamp);
    window.dispatchEvent(new CustomEvent(PICKS_UNREAD_SYNC_EVENT, { detail: { userId } }));
  } catch {
    // Ignore storage access failures on restricted browsers.
  }
}

/** Pending picks posted since the viewer last opened /picks. RLS hides picks the viewer can't read, so this is 0 for them. */
export function usePicksUnread(enabled = true) {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted) setUserId(session?.user?.id ?? null);
    });
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

    if (pathname?.startsWith('/picks')) {
      markPicksAsRead(userId);
      setUnreadCount(0);
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') markPicksAsRead(userId);
      };
      const intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') markPicksAsRead(userId);
      }, 5000);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        window.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    let isMounted = true;

    const checkUnread = async () => {
      const since =
        getPicksLastRead(userId) ?? new Date(Date.now() - FIRST_VISIT_WINDOW_MS).toISOString();
      try {
        // ai_picks is not in the generated Supabase client schema.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count, error } = await (supabase as any)
          .from('ai_picks')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .gt('posted_at', since);
        if (isMounted && !error) setUnreadCount(count ?? 0);
      } catch {
        if (isMounted) setUnreadCount(0);
      }
    };

    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== userId) return;
      void checkUnread();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkUnread();
    };

    void checkUnread();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void checkUnread();
    }, PICKS_POLL_MS);
    window.addEventListener(PICKS_UNREAD_SYNC_EVENT, handleSync as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener(PICKS_UNREAD_SYNC_EVENT, handleSync as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, pathname, userId]);

  return unreadCount;
}
