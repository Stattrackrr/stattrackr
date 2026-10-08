import { loadApiTennisRoster } from '@/lib/tennis/apiTennis';
import { tennisIocToIso2 } from '@/lib/tennis/flags';
import { canonicalTennisIoc } from '@/lib/tennis/nationality';

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
  const roster = loadApiTennisRoster({ allowCacheJson: false });
  for (const player of roster?.players || []) {
    add(index, player.playerId, player.name, player.ioc);
  }
  for (const row of [...(roster?.standings?.ATP || []), ...(roster?.standings?.WTA || [])]) {
    add(index, row.playerId, row.name, row.ioc);
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
  const key = String(name || '').trim().toLowerCase();
  const stored = (id && index.byId.get(id)) || (key && index.byName.get(key)) || null;
  return canonicalTennisIoc({ playerId: id, name, stored });
}

/** Keep a valid stored country; otherwise look the player up on the disk roster. */
export function tennisIocFromStoredOrRoster(input: {
  playerId?: string | null;
  name?: string | null;
  stored?: string | null;
}): string | null {
  return canonicalTennisIoc(input) || resolveTennisIoc(input.playerId, input.name);
}
