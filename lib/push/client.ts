'use client';

import { supabase } from '@/lib/supabaseClient';

export type PickAlertsState = 'loading' | 'unsupported' | 'needs-home-screen' | 'denied' | 'off' | 'on';

const SW_URL = '/sw.js';

function vapidKey(): Uint8Array | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return null;
  const padded = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_URL);
  return existing ?? navigator.serviceWorker.register(SW_URL);
}

async function saveSubscription(sub: PushSubscription): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers) return false;
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  return res.ok;
}

/** Current state; when already subscribed, re-saves it so the device stays tied to this account. */
export async function readPickAlertsState(): Promise<PickAlertsState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (!vapidKey()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return 'off';
  void saveSubscription(sub).catch(() => {});
  return 'on';
}

/** Must run from a tap: iOS only shows the permission prompt for a user gesture. */
export async function enablePickAlerts(): Promise<PickAlertsState> {
  const key = vapidKey();
  if (!pushSupported() || !key) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource }));
  return (await saveSubscription(sub)) ? 'on' : 'off';
}

export async function disablePickAlerts(): Promise<PickAlertsState> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const headers = await authHeaders();
    if (headers) {
      await fetch('/api/push/subscribe', { method: 'DELETE', headers, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    }
    await sub.unsubscribe().catch(() => false);
  }
  return 'off';
}

export async function sendTestPickAlert(): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  const headers = await authHeaders();
  if (!sub || !headers) return false;
  const res = await fetch('/api/push/test', { method: 'POST', headers, body: JSON.stringify({ endpoint: sub.endpoint }) });
  return res.ok;
}

export function clearAppBadge() {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  void nav.clearAppBadge?.().catch(() => {});
}
