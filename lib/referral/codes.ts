import type { SupabaseClient } from '@supabase/supabase-js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Ensure the user has a unique referral_code on their profile; return it. */
export async function ensureReferralCode(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('referral_code')
    .eq('id', userId)
    .maybeSingle();

  if (existing?.referral_code && String(existing.referral_code).trim()) {
    return String(existing.referral_code).trim().toUpperCase();
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode(8);
    const { error } = await supabase
      .from('profiles')
      .update({ referral_code: code, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .is('referral_code', null);

    if (!error) {
      const { data: again } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', userId)
        .maybeSingle();
      if (again?.referral_code) return String(again.referral_code).trim().toUpperCase();
    }

    // Race: another request set a code
    const { data: raced } = await supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', userId)
      .maybeSingle();
    if (raced?.referral_code) return String(raced.referral_code).trim().toUpperCase();
  }

  throw new Error('Failed to allocate referral code');
}

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length >= 4 ? cleaned : null;
}

export async function findReferrerByCode(
  supabase: SupabaseClient,
  code: string
): Promise<{ id: string; email: string | null; referral_code: string } | null> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, email, referral_code')
    .eq('referral_code', normalized)
    .maybeSingle();
  if (!data?.id) return null;
  return {
    id: data.id,
    email: data.email ?? null,
    referral_code: String(data.referral_code),
  };
}
