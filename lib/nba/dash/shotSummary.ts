/**
 * Per-season shot aggregates (players' zones, assists by zone, team defense by zone),
 * built by `scripts/sync-nba-bdl.ts --jobs=shotsummary` and stored in `nba_sync_state`
 * so the dashboard can rank zones league-wide without scanning every shot per request.
 */
import { getNbaClubById } from './teams';
import { nbaZoneFromDb, type NbaShotZoneId } from './shotZonesShared';

/** [fga, fgm] */
export type NbaZoneCounts = Partial<Record<NbaShotZoneId, [number, number]>>;
export type NbaZoneAssists = Partial<Record<NbaShotZoneId, number>>;

export type NbaShotSummaryEntry = {
  /** Games with at least one shot or assist (players) / games defended (teams). */
  g: number;
  z: NbaZoneCounts;
  a: NbaZoneAssists;
};

export type NbaShotSummary = {
  season: number;
  generatedAt: string;
  shots: number;
  /** Keyed by BDL player id. */
  players: Record<string, NbaShotSummaryEntry>;
  /** Keyed by team code: shots the team allowed. */
  defense: Record<string, NbaShotSummaryEntry>;
};

export const nbaShotSummaryJob = (season: number) => `shot-summary:${season}`;

export type NbaShotSummaryRow = {
  game_id: number | string;
  shooter_id: number | string;
  assister_id: number | string | null;
  opponent_team_id: number;
  made: boolean;
  zone: string | null;
};

export function buildNbaShotSummary(season: number, rows: NbaShotSummaryRow[]): NbaShotSummary {
  const players = new Map<string, { games: Set<string>; z: NbaZoneCounts; a: NbaZoneAssists }>();
  const defense = new Map<string, { games: Set<string>; z: NbaZoneCounts; a: NbaZoneAssists }>();
  const bucket = (m: typeof players, key: string) => {
    let b = m.get(key);
    if (!b) {
      b = { games: new Set(), z: {}, a: {} };
      m.set(key, b);
    }
    return b;
  };

  for (const r of rows) {
    const gameId = String(r.game_id);
    const zone = nbaZoneFromDb(r.zone);
    const shooter = bucket(players, String(r.shooter_id));
    shooter.games.add(gameId);
    const defCode = getNbaClubById(r.opponent_team_id)?.code;
    const def = defCode ? bucket(defense, defCode) : null;
    def?.games.add(gameId);
    if (!zone) continue;
    const sz = (shooter.z[zone] ??= [0, 0]);
    sz[0] += 1;
    if (r.made) sz[1] += 1;
    if (def) {
      const dz = (def.z[zone] ??= [0, 0]);
      dz[0] += 1;
      if (r.made) dz[1] += 1;
    }
    if (r.made && r.assister_id != null) {
      const assister = bucket(players, String(r.assister_id));
      assister.games.add(gameId);
      assister.a[zone] = (assister.a[zone] ?? 0) + 1;
      if (def) def.a[zone] = (def.a[zone] ?? 0) + 1;
    }
  }

  const flatten = (m: typeof players) =>
    Object.fromEntries([...m].map(([k, b]) => [k, { g: b.games.size, z: b.z, a: b.a }]));
  return {
    season,
    generatedAt: new Date().toISOString(),
    shots: rows.length,
    players: flatten(players),
    defense: flatten(defense),
  };
}
