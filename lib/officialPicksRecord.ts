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

type OfficialPickBetRow = {
  id: string;
  date: string;
  sport: string;
  market: string | null;
  selection: string;
  stake_units: number | string;
  odds: number | string;
  result: OfficialPickResult;
  bookmaker: string | null;
  created_at: string;
  updated_at: string;
};

// official_picks_bets is not in the generated Supabase client schema yet.
function picksTable() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from('official_picks_bets');
}

function normalizeOfficialPickBet(row: OfficialPickBetRow): OfficialPickBet {
  return {
    id: row.id,
    date: row.date,
    sport: row.sport,
    market: row.market,
    selection: row.selection,
    stake_units: Number(row.stake_units),
    odds: Number(row.odds),
    result: row.result,
    bookmaker: row.bookmaker,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchOfficialPicksBets(): Promise<OfficialPickBet[]> {
  const { data, error } = await picksTable()
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as OfficialPickBetRow[]).map(normalizeOfficialPickBet);
}

export async function insertOfficialPickBet(payload: OfficialPickBetInsert): Promise<OfficialPickBet> {
  const { data, error } = await picksTable()
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

  if (!data) {
    throw new Error('Failed to create official pick');
  }

  return normalizeOfficialPickBet(data as OfficialPickBetRow);
}

export async function updateOfficialPickBet(id: string, payload: OfficialPickBetUpdate): Promise<OfficialPickBet> {
  const { data, error } = await picksTable().update(payload).eq('id', id).select('*').single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Failed to update official pick');
  }

  return normalizeOfficialPickBet(data as OfficialPickBetRow);
}

export async function deleteOfficialPickBet(id: string): Promise<void> {
  const { error } = await picksTable().delete().eq('id', id);
  if (error) {
    throw error;
  }
}
