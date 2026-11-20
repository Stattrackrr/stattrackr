import webpush from 'web-push';
import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { ToolsOpportunity } from '@/lib/tools/types';

export type PushMessage = {
  title: string;
  body: string;
  url?: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag?: string;
  badgeCount?: number;
};

type Recipient = { id: string; endpoint: string; p256dh: string; auth: string };

type ToolsArbRecipient = Recipient & { tools_arb_min_pct: number };

// push_subscriptions is not in the generated Supabase schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;

let configured: boolean | null = null;

const ARB_ALERT_DEDUP_TTL_SEC = 2 * 60 * 60;

function configure(): boolean {
  if (configured != null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@stattrackr.co', publicKey, privateKey);
  configured = true;
  return true;
}

async function sendToRecipients(recipients: Recipient[], message: PushMessage): Promise<{ sent: number; removed: number }> {
  const payload = JSON.stringify(message);
  const gone: string[] = [];
  const delivered: string[] = [];
  await Promise.all(
    recipients.map(async (r) => {
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, {
          TTL: 6 * 60 * 60,
          urgency: 'high',
        });
        delivered.push(r.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped this subscription (app removed, permission revoked).
        if (status === 404 || status === 410) gone.push(r.id);
      }
    })
  );
  if (gone.length) await db().from('push_subscriptions').delete().in('id', gone);
  if (delivered.length) {
    await db().from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).in('id', delivered);
  }
  return { sent: delivered.length, removed: gone.length };
}

/** Alert every device allowed to read AI picks. Never throws; posting a pick must not fail on a push. */
export async function sendNewPicksPush(
  picks: Array<{ id: string; title: string }>
): Promise<{ sent: number; removed: number; error?: string }> {
  if (!picks.length) return { sent: 0, removed: 0 };
  const titles = picks.map((p) => p.title);
  // Tapping the alert opens the feed scrolled to the (first) new pick.
  const url = `/picks?pick=${encodeURIComponent(picks[0]!.id)}`;
  if (!configure()) return { sent: 0, removed: 0, error: 'VAPID keys not set' };
  try {
    const { data, error } = await db().rpc('push_pick_recipients');
    if (error) return { sent: 0, removed: 0, error: error.message };
    const recipients = (data ?? []) as Recipient[];
    if (!recipients.length) return { sent: 0, removed: 0 };
    const message: PushMessage =
      titles.length === 1
        ? { title: 'New StatTrackr AI pick', body: titles[0]!, url, tag: 'ai-picks', badgeCount: 1 }
        : {
            title: `${titles.length} new StatTrackr AI picks`,
            body: titles.slice(0, 3).join(' · '),
            url,
            tag: 'ai-picks',
            badgeCount: titles.length,
          };
    return await sendToRecipients(recipients, message);
  } catch (e) {
    return { sent: 0, removed: 0, error: (e as Error).message };
  }
}

function arbPct(edge: number): number {
  return Math.round(edge * 1000) / 10;
}

function arbBody(op: ToolsOpportunity): string {
  const books = op.legs.map((l) => l.book).filter(Boolean).join(' / ');
  const market = op.market || op.legs[0]?.selection || 'Market';
  const match = op.match || `${op.away} vs ${op.home}`;
  return [match, market, books].filter(Boolean).join(' · ');
}

async function wasArbAlerted(opId: string): Promise<boolean> {
  try {
    const hit = await sharedCache.getJSON<string>(`tools:arb-alerted:${opId}`);
    return hit != null;
  } catch {
    return false;
  }
}

async function markArbAlerted(opId: string): Promise<void> {
  try {
    await sharedCache.setJSON(`tools:arb-alerted:${opId}`, '1', ARB_ALERT_DEDUP_TTL_SEC);
  } catch {
    /* best-effort dedupe */
  }
}

/**
 * Notify Tools arb subscribers when a new arb meets their min ROI %.
 * Never throws — warm-tools cron must not fail on push.
 */
export async function sendToolsArbPush(
  opportunities: ToolsOpportunity[]
): Promise<{ sent: number; removed: number; skipped: number; error?: string }> {
  const arbs = opportunities.filter((op) => op.kind === 'arb' && Number.isFinite(op.edge) && op.edge > 0);
  if (!arbs.length) return { sent: 0, removed: 0, skipped: 0 };
  if (!configure()) return { sent: 0, removed: 0, skipped: 0, error: 'VAPID keys not set' };

  try {
    const { data, error } = await db().rpc('push_tools_arb_recipients');
    if (error) return { sent: 0, removed: 0, skipped: 0, error: error.message };
    const recipients = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      endpoint: String(r.endpoint),
      p256dh: String(r.p256dh),
      auth: String(r.auth),
      tools_arb_min_pct: Number(r.tools_arb_min_pct),
    })) as ToolsArbRecipient[];
    if (!recipients.length) return { sent: 0, removed: 0, skipped: 0 };

    let sent = 0;
    let removed = 0;
    let skipped = 0;

    const fresh: ToolsOpportunity[] = [];
    for (const op of arbs) {
      if (await wasArbAlerted(op.id)) skipped += 1;
      else fresh.push(op);
    }
    if (!fresh.length) return { sent: 0, removed: 0, skipped };

    // One alert per device per tick: best fresh arb at or above their threshold.
    const byOpId = new Map<string, { op: ToolsOpportunity; recipients: ToolsArbRecipient[] }>();
    const eligibleIds = new Set<string>();
    for (const r of recipients) {
      const minPct = Number.isFinite(r.tools_arb_min_pct) ? r.tools_arb_min_pct : 2;
      let best: ToolsOpportunity | null = null;
      for (const op of fresh) {
        if (arbPct(op.edge) + 1e-9 < minPct) continue;
        eligibleIds.add(op.id);
        if (!best || op.edge > best.edge) best = op;
      }
      if (!best) continue;
      const bucket = byOpId.get(best.id) ?? { op: best, recipients: [] };
      bucket.recipients.push(r);
      byOpId.set(best.id, bucket);
    }

    for (const { op, recipients: matched } of byOpId.values()) {
      const pct = arbPct(op.edge);
      const result = await sendToRecipients(matched, {
        title: `Arb +${pct.toFixed(1)}%`,
        body: arbBody(op),
        url: '/tools',
        tag: 'tools-arb',
        badgeCount: 1,
      });
      sent += result.sent;
      removed += result.removed;
    }

    // Dedupe every arb that met someone's threshold this tick (including ones we skipped
    // because a better arb was sent to that device).
    await Promise.all([...eligibleIds].map((id) => markArbAlerted(id)));

    return { sent, removed, skipped };
  } catch (e) {
    return { sent: 0, removed: 0, skipped: 0, error: (e as Error).message };
  }
}

/** One device, used by the "send test" button so a user can confirm alerts work. */
export async function sendTestPush(
  endpoint: string,
  userId: string,
  kind: 'picks' | 'tools-arb' = 'picks'
): Promise<{ sent: number; removed: number; error?: string }> {
  if (!configure()) return { sent: 0, removed: 0, error: 'VAPID keys not set' };
  const { data, error } = await db()
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, tools_arb_min_pct')
    .eq('endpoint', endpoint)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { sent: 0, removed: 0, error: error.message };
  if (!data) return { sent: 0, removed: 0, error: 'Device not subscribed' };
  if (kind === 'tools-arb') {
    const minPct =
      typeof data.tools_arb_min_pct === 'number' ? Number(data.tools_arb_min_pct) : 2;
    const samplePct = Number.isFinite(minPct) ? minPct : 2;
    // Same shape as a real arb alert so the user sees exactly what they'll get.
    return sendToRecipients([data as Recipient], {
      title: `Arb +${samplePct.toFixed(1)}%`,
      body: 'Sample Match · Moneyline · PointsBet / Dabble',
      url: '/tools',
      tag: 'tools-arb-test',
      badgeCount: 1,
    });
  }
  return sendToRecipients([data as Recipient], {
    title: 'Pick alerts are on',
    body: "You'll get a notification here when Stattrackr AI posts a new pick.",
    url: '/picks',
    tag: 'ai-picks-test',
  });
}
