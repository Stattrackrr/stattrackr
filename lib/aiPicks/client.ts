import { supabase } from '@/lib/supabaseClient';
import type { OfficialPickBet } from '@/lib/officialPicksRecord';
import { aiPickFromRow, type AiPickRow } from '@/lib/aiPicks/rows';
import type { AiPick } from '@/lib/aiPicks/types';

// AI picks tables are not in the generated Supabase client schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

/** Newest first. RLS returns nothing unless the viewer is admin, or picks are public and the viewer is premium. */
export async function fetchAiPicks(limit = 200): Promise<AiPick[]> {
  const { data, error } = await db()
    .from('ai_picks')
    .select('*, ai_pick_legs(*)')
    .order('posted_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as AiPickRow[]).map(aiPickFromRow);
}

export async function fetchAiPicksPublic(): Promise<boolean> {
  const { data, error } = await db().from('ai_picks_settings').select('is_public').maybeSingle();
  if (error) return false;
  return Boolean(data?.is_public);
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
