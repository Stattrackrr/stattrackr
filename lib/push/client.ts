'use client';

import { supabase } from '@/lib/supabaseClient';

export type PickAlertsState = 'loading' | 'unsupported' | 'needs-home-screen' | 'denied' | 'off' | 'on';

export type ToolsArbAlertsState = PickAlertsState;

export const TOOLS_ARB_DEFAULT_MIN_PCT = 2;
export const TOOLS_ARB_MIN_PCT = 0.5;
export const TOOLS_ARB_MAX_PCT = 20;

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

export function clampToolsArbMinPct(value: number): number {
  if (!Number.isFinite(value)) return TOOLS_ARB_DEFAULT_MIN_PCT;
  return Math.min(TOOLS_ARB_MAX_PCT, Math.max(TOOLS_ARB_MIN_PCT, Math.round(value * 10) / 10));
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

async function ensureSubscription(): Promise<PushSubscription | null> {
  const key = vapidKey();
  if (!pushSupported() || !key) return null;
  if (Notification.permission === 'denied') return null;
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  return (
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource }))
  );
}

async function saveSubscription(
  sub: PushSubscription,
  extras: { picks?: boolean; toolsArb?: boolean; toolsArbMinPct?: number } = {}
): Promise<{ ok: boolean; toolsArb?: boolean; toolsArbMinPct?: number }> {
  const headers = await authHeaders();
  if (!headers) return { ok: false };
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({ subscription: sub.toJSON(), ...extras }),
  });
  if (!res.ok) return { ok: false };
  const json = (await res.json().catch(() => ({}))) as {
    toolsArb?: boolean;
    toolsArbMinPct?: number;
  };
  return {
    ok: true,
    toolsArb: json.toolsArb,
    toolsArbMinPct: json.toolsArbMinPct,
  };
}

async function fetchToolsArbPrefs(sub: PushSubscription): Promise<{ toolsArb: boolean; toolsArbMinPct: number }> {
  const headers = await authHeaders();
  if (!headers) return { toolsArb: false, toolsArbMinPct: TOOLS_ARB_DEFAULT_MIN_PCT };
  const res = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
    headers: { Authorization: headers.Authorization },
  });
  if (!res.ok) return { toolsArb: false, toolsArbMinPct: TOOLS_ARB_DEFAULT_MIN_PCT };
  const json = (await res.json().catch(() => ({}))) as { toolsArb?: boolean; toolsArbMinPct?: number };
  return {
    toolsArb: Boolean(json.toolsArb),
    toolsArbMinPct: clampToolsArbMinPct(Number(json.toolsArbMinPct ?? TOOLS_ARB_DEFAULT_MIN_PCT)),
  };
}

/** Current state; when already subscribed, re-saves it so the device stays tied to this account. */
export async function readPickAlertsState(): Promise<PickAlertsState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (!vapidKey()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return 'off';
  void saveSubscription(sub, { picks: true }).catch(() => {});
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
  const saved = await saveSubscription(sub, { picks: true });
  return saved.ok ? 'on' : 'off';
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
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers,
    body: JSON.stringify({ endpoint: sub.endpoint, kind: 'picks' }),
  });
  return res.ok;
}

export async function readToolsArbAlertsState(): Promise<{
  state: ToolsArbAlertsState;
  minPct: number;
}> {
  if (!pushSupported()) {
    return {
      state: isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported',
      minPct: TOOLS_ARB_DEFAULT_MIN_PCT,
    };
  }
  if (!vapidKey()) return { state: 'unsupported', minPct: TOOLS_ARB_DEFAULT_MIN_PCT };
  if (Notification.permission === 'denied') return { state: 'denied', minPct: TOOLS_ARB_DEFAULT_MIN_PCT };
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') {
    return { state: 'off', minPct: TOOLS_ARB_DEFAULT_MIN_PCT };
  }
  const prefs = await fetchToolsArbPrefs(sub);
  return {
    state: prefs.toolsArb ? 'on' : 'off',
    minPct: prefs.toolsArbMinPct,
  };
}

/** Must run from a tap. Enables push + Tools arb channel at minPct. */
export async function enableToolsArbAlerts(minPct = TOOLS_ARB_DEFAULT_MIN_PCT): Promise<{
  state: ToolsArbAlertsState;
  minPct: number;
}> {
  const pct = clampToolsArbMinPct(minPct);
  if (!pushSupported() || !vapidKey()) return { state: 'unsupported', minPct: pct };
  const sub = await ensureSubscription();
  if (!sub) {
    if (Notification.permission === 'denied') return { state: 'denied', minPct: pct };
    return { state: 'off', minPct: pct };
  }
  const saved = await saveSubscription(sub, { toolsArb: true, toolsArbMinPct: pct });
  return {
    state: saved.ok ? 'on' : 'off',
    minPct: saved.toolsArbMinPct != null ? clampToolsArbMinPct(saved.toolsArbMinPct) : pct,
  };
}

export async function updateToolsArbMinPct(minPct: number): Promise<{
  state: ToolsArbAlertsState;
  minPct: number;
}> {
  const pct = clampToolsArbMinPct(minPct);
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return { state: 'off', minPct: pct };
  const saved = await saveSubscription(sub, { toolsArb: true, toolsArbMinPct: pct });
  return {
    state: saved.ok ? 'on' : 'off',
    minPct: saved.toolsArbMinPct != null ? clampToolsArbMinPct(saved.toolsArbMinPct) : pct,
  };
}

/** Turns off Tools arb alerts only; keeps the device subscribed if pick alerts are still on. */
export async function disableToolsArbAlerts(): Promise<{
  state: ToolsArbAlertsState;
  minPct: number;
}> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { state: 'off', minPct: TOOLS_ARB_DEFAULT_MIN_PCT };
  const prefs = await fetchToolsArbPrefs(sub);
  const saved = await saveSubscription(sub, {
    toolsArb: false,
    toolsArbMinPct: prefs.toolsArbMinPct,
  });
  return {
    state: 'off',
    minPct: saved.toolsArbMinPct != null ? clampToolsArbMinPct(saved.toolsArbMinPct) : prefs.toolsArbMinPct,
  };
}

export async function sendTestToolsArbAlert(): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  const headers = await authHeaders();
  if (!sub || !headers) return false;
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers,
    body: JSON.stringify({ endpoint: sub.endpoint, kind: 'tools-arb' }),
  });
  return res.ok;
}

export function clearAppBadge() {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  void nav.clearAppBadge?.().catch(() => {});
}
