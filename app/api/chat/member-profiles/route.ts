export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { evaluateBadges, resolveDisplayedBadgeIds } from '@/lib/badges/evaluate';
import { isDataAdminEmail } from '@/lib/adminEmail';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDS = 100;

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createServiceClient(url, key);
}

async function getUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const supabase = await createClient();
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const {
    data: { user },
    error,
  } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/**
 * Live avatar + equipped badges for chat authors.
 * Messages snapshot avatar_url at send time; this returns current profile state.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { userIds?: unknown } | null;
    const rawIds = Array.isArray(body?.userIds) ? body.userIds : [];
    const userIds = [
      ...new Set(
        rawIds
          .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
          .slice(0, MAX_IDS)
      ),
    ];

    if (userIds.length === 0) {
      return NextResponse.json({ profiles: {} });
    }

    const service = getServiceSupabase();
    const { data: profiles, error: profileError } = await service
      .from('profiles')
      .select(
        'id, email, username, full_name, avatar_url, created_at, subscription_status, subscription_tier, referred_by_user_id, displayed_badge_ids'
      )
      .in('id', userIds);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const { data: referralRows } = await service
      .from('referrals')
      .select('referrer_user_id')
      .in('referrer_user_id', userIds)
      .eq('status', 'active');

    const referralCounts = new Map<string, number>();
    for (const row of referralRows ?? []) {
      const id = String((row as { referrer_user_id?: string }).referrer_user_id || '');
      if (!id) continue;
      referralCounts.set(id, (referralCounts.get(id) ?? 0) + 1);
    }

    const out: Record<
      string,
      {
        avatarUrl: string | null;
        displayedBadgeIds: string[];
        badges: ReturnType<typeof evaluateBadges>;
        username: string | null;
        displayName: string;
        createdAt: string | null;
        membership: 'admin' | 'pro' | 'free';
      }
    > = {};

    for (const profile of profiles ?? []) {
      const row = profile as {
        id: string;
        email?: string | null;
        username?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
        created_at?: string | null;
        subscription_status?: string | null;
        subscription_tier?: string | null;
        referred_by_user_id?: string | null;
        displayed_badge_ids?: string[] | null;
      };

      const isAdmin = isDataAdminEmail(row.email);
      const badges = evaluateBadges({
        createdAt: row.created_at || new Date(0).toISOString(),
        subscriptionStatus: row.subscription_status ?? null,
        subscriptionTier: row.subscription_tier ?? null,
        referredByUserId: row.referred_by_user_id ?? null,
        activeReferralCount: referralCounts.get(row.id) ?? 0,
        isAdmin,
      });

      const username = row.username ? String(row.username).trim() || null : null;
      const fullName = row.full_name ? String(row.full_name).trim() || null : null;
      const emailLocal = row.email ? String(row.email).split('@')[0]?.trim() || null : null;
      const status = String(row.subscription_status || '').toLowerCase();
      const tier = String(row.subscription_tier || '').toLowerCase();
      const isPro = (status === 'active' || status === 'trialing') && tier === 'pro';

      out[row.id] = {
        avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
        displayedBadgeIds: resolveDisplayedBadgeIds(badges, row.displayed_badge_ids ?? null),
        badges,
        username,
        displayName: username || fullName || emailLocal || 'Member',
        createdAt: row.created_at ? String(row.created_at) : null,
        membership: isAdmin ? 'admin' : isPro ? 'pro' : 'free',
      };
    }

    return NextResponse.json({ profiles: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
