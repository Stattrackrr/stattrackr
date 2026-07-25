/**
 * Committed Role Stats leaders snapshot (refreshed by AFL Process Stats).
 */

import fs from 'fs';
import path from 'path';
import type { RoleLeaderRow, RoleLeadersResult } from '@/lib/afl/footyinfoFantasyTools';

export type AflRoleLeadersTeamSnapshot = {
  slug: string;
  name: string;
  abbrev?: string;
  cba: RoleLeadersResult;
  kick_ins: RoleLeadersResult;
};

export type AflRoleLeadersSnapshot = {
  season: number;
  generatedAt: string;
  source: string;
  teams: Record<string, AflRoleLeadersTeamSnapshot>;
};

const memoryCache = new Map<number, { expiresAt: number; data: AflRoleLeadersSnapshot | null }>();
const TTL_MS = 1000 * 60 * 5;

export function roleLeadersSnapshotPath(season: number): string {
  return path.join(process.cwd(), 'data', `afl-role-leaders-${season}.json`);
}

export function readRoleLeadersSnapshot(season: number): AflRoleLeadersSnapshot | null {
  const cached = memoryCache.get(season);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const raw = fs.readFileSync(roleLeadersSnapshotPath(season), 'utf8');
    const data = JSON.parse(raw) as AflRoleLeadersSnapshot;
    if (!data || typeof data !== 'object' || !data.teams) {
      memoryCache.set(season, { expiresAt: Date.now() + TTL_MS, data: null });
      return null;
    }
    memoryCache.set(season, { expiresAt: Date.now() + TTL_MS, data });
    return data;
  } catch {
    memoryCache.set(season, { expiresAt: Date.now() + TTL_MS, data: null });
    return null;
  }
}

export function getRoleLeadersFromSnapshot(
  season: number,
  teamSlug: string,
  stat: 'cba' | 'kick_ins',
  limit: number
): { leaders: RoleLeaderRow[]; teamTotal: number; generatedAt: string | null } | null {
  const snapshot = readRoleLeadersSnapshot(season);
  const team = snapshot?.teams?.[teamSlug];
  if (!team) return null;
  const block = stat === 'cba' ? team.cba : team.kick_ins;
  if (!block) return null;
  const leaders = Array.isArray(block.leaders) ? block.leaders.slice(0, Math.max(1, limit)) : [];
  return {
    leaders,
    teamTotal: Number(block.teamTotal) || 0,
    generatedAt: snapshot?.generatedAt || null,
  };
}
