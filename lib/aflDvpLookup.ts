/**
 * Shared DvP lookup for AFL props (list API and warm endpoint).
 * Maps opponent names to DvP file keys (afl-dvp-*.json uses short names).
 */

const OPPONENT_TO_DVP_KEY: Record<string, string> = {
  'adelaide crows': 'adelaide', adelaide: 'adelaide',
  'brisbane lions': 'brisbane', brisbane: 'brisbane',
  'carlton blues': 'carlton', carlton: 'carlton',
  'collingwood magpies': 'collingwood', collingwood: 'collingwood',
  'essendon bombers': 'essendon', essendon: 'essendon',
  'fremantle dockers': 'fremantle', fremantle: 'fremantle',
  'geelong cats': 'geelong', geelong: 'geelong',
  'gold coast suns': 'gold coast', 'gold coast': 'gold coast',
  'gws giants': 'gws', 'greater western sydney giants': 'gws', gws: 'gws',
  'hawthorn hawks': 'hawthorn', hawthorn: 'hawthorn',
  'melbourne demons': 'melbourne', melbourne: 'melbourne',
  'north melbourne kangaroos': 'north melbourne', 'north melbourne': 'north melbourne',
  'port adelaide power': 'port adelaide', 'port adelaide': 'port adelaide',
  'richmond tigers': 'richmond', richmond: 'richmond',
  'st kilda saints': 'st kilda', 'st kilda': 'st kilda',
  'sydney swans': 'sydney', sydney: 'sydney',
  'west coast eagles': 'west coast', 'west coast': 'west coast',
  'western bulldogs': 'western bulldogs', footscray: 'western bulldogs',
};

export function normalizeOpponentForDvp(opponent: string): string {
  const s = (opponent || '').trim().toLowerCase();
  if (!s) return s;
  return OPPONENT_TO_DVP_KEY[s] ?? s.split(/\s+/)[0] ?? s;
}

export type DvpMaps = {
  disposals: Map<string, { rank: number; value: number }>;
  goals: Map<string, { rank: number; value: number }>;
};

export async function loadDvpMaps(origin: string): Promise<DvpMaps> {
  const currentYear = new Date().getFullYear();
  const build = (data: { rows?: Array<{ opponent?: string; rank?: number; value?: number }> } | null) => {
    const map = new Map<string, { rank: number; value: number }>();
    if (!data?.rows) return map;
    for (const row of data.rows) {
      const key = (row.opponent || '').trim().toLowerCase();
      if (!key) continue;
      const rank = typeof row.rank === 'number' ? row.rank : 0;
      const value = typeof row.value === 'number' ? row.value : 0;
      const existing = map.get(key);
      if (!existing || rank < existing.rank) {
        const entry = { rank, value };
        map.set(key, entry);
        for (const [full, short] of Object.entries(OPPONENT_TO_DVP_KEY))
          if (short === key) map.set(full, entry);
      }
    }
    return map;
  };
  const trySeason = async (season: number) => {
    const [disp, goals] = await Promise.all([
      fetch(`${origin}/api/afl/dvp?season=${season}&stat=disposals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${origin}/api/afl/dvp?season=${season}&stat=goals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
    ]);
    const d = build(disp);
    const g = build(goals);
    return { disposals: d, goals: g, hasData: d.size > 0 || g.size > 0 };
  };
  let result = await trySeason(currentYear);
  if (!result.hasData && currentYear > 2020) {
    const fallback = await trySeason(currentYear - 1);
    if (fallback.hasData) result = fallback;
  }
  return { disposals: result.disposals, goals: result.goals };
}

export function getDvpLookup(
  opponent: string,
  statType: string,
  maps: DvpMaps
): { rank: number; value: number } | null {
  const opp = (opponent || '').trim().toLowerCase();
  const m = statType === 'goals_over' ? maps.goals : maps.disposals;
  let out = m.get(opp);
  if (out) return out;
  const normalized = normalizeOpponentForDvp(opponent);
  if (normalized) out = m.get(normalized);
  if (out) return out;
  const entry = Array.from(m.entries()).find(([team]) => team.includes(opp) || opp.includes(team));
  return entry ? entry[1] : null;
}
