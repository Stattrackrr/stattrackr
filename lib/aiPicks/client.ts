import { supabase } from '@/lib/supabaseClient';
import type { OfficialPickBet } from '@/lib/officialPicksRecord';
import { aiPickFromRow, type AiPickRow } from '@/lib/aiPicks/rows';
import type { AiPick } from '@/lib/aiPicks/types';

// AI picks tables are not in the generated Supabase client schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

type AiPicksSettings = { isPublic: boolean; publicSince: string | null };

export async function fetchAiPicksSettings(): Promise<AiPicksSettings> {
  const { data, error } = await db().from('ai_picks_settings').select('*').maybeSingle();
  if (error || !data) return { isPublic: false, publicSince: null };
  return { isPublic: Boolean(data.is_public), publicSince: data.public_since ?? null };
}

/**
 * Newest first, without picks settled before the public record's start date (admin sees the same record
 * as everyone else). RLS returns nothing unless the viewer is admin, or picks are public and the viewer is premium.
 */
export async function fetchAiPicks(limit = 200): Promise<AiPick[]> {
  const { publicSince } = await fetchAiPicksSettings();
  let query = db().from('ai_picks').select('*, ai_pick_legs(*)');
  if (publicSince) query = query.or(`settled_at.is.null,settled_at.gte."${publicSince}"`);
  const { data, error } = await query.order('posted_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as AiPickRow[]).map(aiPickFromRow);
}

/** Picks the signed-in member marked "Added"; null when signed out or the table is not there yet. */
export async function fetchAddedPickIds(): Promise<Set<string> | null> {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return null;
  const { data, error } = await db().from('ai_pick_added').select('pick_id');
  if (error) return null;
  return new Set(((data ?? []) as Array<{ pick_id: string }>).map((r) => r.pick_id));
}

export async function setPickAdded(pickId: string, added: boolean): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error('Not signed in');
  const { error } = added
    ? await db().from('ai_pick_added').upsert({ user_id: userId, pick_id: pickId }, { onConflict: 'user_id,pick_id', ignoreDuplicates: true })
    : await db().from('ai_pick_added').delete().eq('user_id', userId).eq('pick_id', pickId);
  if (error) throw new Error(error.message);
}

export async function fetchAiPicksPublic(): Promise<boolean> {
  return (await fetchAiPicksSettings()).isPublic;
}

/** Map AI picks onto the record modal's bet shape (push counts as void: stake returned). */
export function aiPicksAsRecordBets(picks: AiPick[]): OfficialPickBet[] {
  return picks.map((p) => ({
    id: p.id,
    date: p.postedAt.slice(0, 10),
    sport: p.sport.toUpperCase(),
    market: p.kind === 'multi' ? 'Multi' : p.legs[0]?.market ?? null,
    selection: p.title,
    stake_units: p.units,
    odds: p.status === 'win' && p.profitUnits != null ? 1 + p.profitUnits / p.units : p.price,
    result: p.status === 'push' ? 'void' : p.status,
    bookmaker: p.bookmaker,
    created_at: p.postedAt,
    updated_at: p.settledAt ?? p.postedAt,
  }));
}
