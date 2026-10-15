import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Site-wide "online now" via Supabase Realtime presence. One channel per tab, keyed by a per-browser
 * id, so several tabs in one browser count once. Nothing is stored server-side.
 */

const CHANNEL = 'site-online';
const VISITOR_KEY = 'st_visitor_id';

type Listener = (count: number | null) => void;

const listeners = new Set<Listener>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let joins = 0;
let onlineCount: number | null = null;

function visitorId(): string {
  const fresh = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored) return stored;
    const id = fresh();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

function publish(count: number | null) {
  onlineCount = count;
  listeners.forEach((listener) => listener(count));
}

/** Join the site presence channel; returns a leave function. Safe to call from several components. */
export function joinSitePresence(): () => void {
  joins += 1;
  if (!channel) {
    const next = supabase.channel(CHANNEL, { config: { presence: { key: visitorId() } } });
    next
      .on('presence', { event: 'sync' }, () => publish(Object.keys(next.presenceState()).length))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void next.track({ online_at: new Date().toISOString() });
      });
    channel = next;
  }
  return () => {
    joins -= 1;
    if (joins > 0 || !channel) return;
    void supabase.removeChannel(channel);
    channel = null;
    publish(null);
  };
}

/** Live count of visitors on any page of the site; null until the first presence sync. */
export function useSiteOnlineCount(): number | null {
  const [count, setCount] = useState<number | null>(onlineCount);
  useEffect(() => {
    listeners.add(setCount);
    setCount(onlineCount);
    return () => {
      listeners.delete(setCount);
    };
  }, []);
  return count;
}
