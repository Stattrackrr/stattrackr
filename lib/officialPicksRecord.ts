import { supabase } from '@/lib/supabaseClient';

export type OfficialPickResult = 'win' | 'loss' | 'void' | 'pending';

export type OfficialPickBet = {
  id: string;
  date: string;
  sport: string;
  market: string | null;
  selection: string;
  stake_units: number;
  odds: number;
  result: OfficialPickResult;
  bookmaker: string | null;
  created_at: string;
  updated_at: string;
};

export type OfficialPickBetInsert = {
  date: string;
  sport?: string;
  market?: string | null;
  selection: string;
  stake_units?: number;
  odds: number;
  result?: OfficialPickResult;
  bookmaker?: string | null;
};

export type OfficialPickBetUpdate = Partial<
  Pick<OfficialPickBet, 'date' | 'sport' | 'market' | 'selection' | 'stake_units' | 'odds' | 'result' | 'bookmaker'>
>;

export async function fetchOfficialPicksBets(): Promise<OfficialPickBet[]> {
  const { data, error } = await supabase
    .from('official_picks_bets')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    ...row,
    stake_units: Number(row.stake_units),
    odds: Number(row.odds),
  })) as OfficialPickBet[];
}

export async function insertOfficialPickBet(payload: OfficialPickBetInsert): Promise<OfficialPickBet> {
  const { data, error } = await supabase
    .from('official_picks_bets')
    .insert({
      date: payload.date,
      sport: payload.sport ?? 'NBA',
      market: payload.market ?? null,
      selection: payload.selection.trim(),
      stake_units: payload.stake_units ?? 1,
      odds: payload.odds,
      result: payload.result ?? 'pending',
      bookmaker: payload.bookmaker ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return {
    ...data,
    stake_units: Number(data.stake_units),
    odds: Number(data.odds),
  } as OfficialPickBet;
}

export async function updateOfficialPickBet(id: string, payload: OfficialPickBetUpdate): Promise<OfficialPickBet> {
  const { data, error } = await supabase
    .from('official_picks_bets')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return {
    ...data,
    stake_units: Number(data.stake_units),
    odds: Number(data.odds),
  } as OfficialPickBet;
}

export async function deleteOfficialPickBet(id: string): Promise<void> {
  const { error } = await supabase.from('official_picks_bets').delete().eq('id', id);
  if (error) {
    throw error;
  }
}
