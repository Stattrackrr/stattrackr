import { loadTennisPlayers, loadTennisRankings } from '@/lib/tennis/data';
import { tennisIocToIso2 } from '@/lib/tennis/flags';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';

type IocIndex = {
  byId: Map<string, string>;
  byName: Map<string, string>;
};

let cached: IocIndex | null = null;

function validIoc(value: string | null | undefined): string | null {
  const code = String(value || '').trim().toUpperCase();
  if (!code || !tennisIocToIso2(code)) return null;
  return code;
}

function remember(map: Map<string, string>, key: string, ioc: string) {
  const k = String(key || '').trim();
  if (!k || map.has(k)) return;
  map.set(k, ioc);
}

function add(index: IocIndex, id: string | null | undefined, name: string | null | undefined, ioc: string | null | undefined) {
  const code = validIoc(ioc);
  if (!code) return;
  if (id) remember(index.byId, String(id).trim(), code);
  if (name) remember(index.byName, name.trim().toLowerCase(), code);
}

function iocIndex(): IocIndex {
  if (cached && (cached.byId.size > 0 || cached.byName.size > 0)) return cached;
  const index: IocIndex = { byId: new Map(), byName: new Map() };
  for (const player of loadTennisPlayers()) {
    add(index, player.playerId, player.name, player.ioc);
  }
  for (const tour of ['ATP', 'WTA'] as const) {
    for (const row of loadTennisRankings(tour, { limit: 2000 })) {
      add(index, row.playerId, row.name, row.ioc);
    }
  }
  if (index.byId.size || index.byName.size) cached = index;
  return index;
}

export function resolveTennisIoc(
  playerId?: string | null,
  name?: string | null
): string | null {
  const index = iocIndex();
  const id = String(playerId || '').trim();
  if (id && index.byId.has(id)) return index.byId.get(id) || null;
  if (id) {
    for (const player of loadTennisPlayers()) {
      if (player.playerId !== id) continue;
      const code = validIoc(player.ioc);
      if (code) return code;
    }
  }
  const key = String(name || '').trim().toLowerCase();
  if (key && index.byName.has(key)) return index.byName.get(key) || null;
  if (!key) return null;
  const hits: string[] = [];
  for (const [playerName, ioc] of index.byName) {
    if (!tennisIdentityMatch(playerName, key)) continue;
    if (!hits.includes(ioc)) hits.push(ioc);
    if (hits.length > 1) break;
  }
  return hits.length === 1 ? hits[0] : null;
}
