import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type PushMessage = {
  title: string;
  body: string;
  url?: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag?: string;
  badgeCount?: number;
};

type Recipient = { id: string; endpoint: string; p256dh: string; auth: string };

// push_subscriptions is not in the generated Supabase schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;

let configured: boolean | null = null;

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
export async function sendNewPicksPush(titles: string[]): Promise<{ sent: number; removed: number; error?: string }> {
  if (!titles.length) return { sent: 0, removed: 0 };
  if (!configure()) return { sent: 0, removed: 0, error: 'VAPID keys not set' };
  try {
    const { data, error } = await db().rpc('push_pick_recipients');
    if (error) return { sent: 0, removed: 0, error: error.message };
    const recipients = (data ?? []) as Recipient[];
    if (!recipients.length) return { sent: 0, removed: 0 };
    const message: PushMessage =
      titles.length === 1
        ? { title: 'New StatTrackr AI pick', body: titles[0]!, url: '/picks', tag: 'ai-picks', badgeCount: 1 }
        : {
            title: `${titles.length} new StatTrackr AI picks`,
            body: titles.slice(0, 3).join(' · '),
            url: '/picks',
            tag: 'ai-picks',
            badgeCount: titles.length,
          };
    return await sendToRecipients(recipients, message);
  } catch (e) {
    return { sent: 0, removed: 0, error: (e as Error).message };
  }
}

/** One device, used by the "send test" button so a user can confirm alerts work. */
export async function sendTestPush(endpoint: string, userId: string): Promise<{ sent: number; removed: number; error?: string }> {
  if (!configure()) return { sent: 0, removed: 0, error: 'VAPID keys not set' };
  const { data, error } = await db()
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('endpoint', endpoint)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { sent: 0, removed: 0, error: error.message };
  if (!data) return { sent: 0, removed: 0, error: 'Device not subscribed' };
  return sendToRecipients([data as Recipient], {
    title: 'Pick alerts are on',
    body: "You'll get a notification here when Stattrackr AI posts a new pick.",
    url: '/picks',
    tag: 'ai-picks-test',
  });
}
