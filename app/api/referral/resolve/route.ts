export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { findReferrerByCode, normalizeReferralCode } from '@/lib/referral/codes';
import { REFERRAL_FRIEND_PERCENT } from '@/lib/referral/constants';

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createServiceClient(url, key);
}

/** Public: validate a referral code for pricing banner. */
export async function GET(request: NextRequest) {
  try {
    const code = normalizeReferralCode(request.nextUrl.searchParams.get('code'));
    if (!code) {
      return NextResponse.json({ valid: false, reason: 'Missing code' }, { status: 400 });
    }
    const referrer = await findReferrerByCode(getServiceSupabase(), code);
    if (!referrer) {
      return NextResponse.json({ valid: false, reason: 'Invalid code' });
    }
    return NextResponse.json({
      valid: true,
      code: referrer.referral_code,
      discountPercent: REFERRAL_FRIEND_PERCENT,
    });
  } catch (err: any) {
    return NextResponse.json({ valid: false, reason: err.message }, { status: 500 });
  }
}
