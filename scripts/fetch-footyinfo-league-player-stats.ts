#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { fetchFootyinfoJson } from '../lib/afl/footyinfoHttp';
import { footyinfoPlayerSlug } from '../lib/afl/footyinfoTeamMapping';

type Cell = { value?: unknown };
type Summary = { leagues?: Array<{ competition_type_id?: number; game_logs_summary?: { rows?: Array<Record<string, Cell>> } }> };
type Seed = { name?: string; team?: string };

const season = Number(process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) || new Date().getFullYear());
const concurrency = Math.max(1, Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.slice(14) || 12));
const file = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);

const seed = JSON.parse(fs.readFileSync(file, 'utf8')) as { players?: Seed[] };
const number = (row: Record<string, Cell>, field: string) => Number(row[field]?.value) || 0;
const text = (row: Record<string, Cell>, field: string) => String(row[field]?.value || '');

type PlayerRow = {
  name: Seed['name'];
  team: Seed['team'];
  games: number;
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  goals: number;
  tackles: number;
  clearances: number;
  inside_50s: number;
  rebound_50s: number;
  contested_possessions: number;
  uncontested_possessions: number;
  meters_gained: number;
  free_kicks_for: number;
};
type Attempt =
  | { ok: true; player: PlayerRow }
  | { ok: false; status: number; error: string };

async function one(player: Seed): Promise<Attempt> {
  const slug = footyinfoPlayerSlug(player.name || '');
  if (!slug) return { ok: false, status: 0, error: 'empty-slug' };
  const response = await fetchFootyinfoJson<Summary>(`/player/${encodeURIComponent(slug)}/game_logs_summary?mode=averages&columns=all`);
  if (!response.ok) return { ok: false, status: response.status, error: response.error };
  const league =
    response.data.leagues?.find((item) => item.competition_type_id === 1) ||
    response.data.leagues?.[0];
  const row = league?.game_logs_summary?.rows?.find((item) => text(item, 'season') === String(season));
  if (!row) return { ok: false, status: response.status, error: 'no-season-row' };
  if (number(row, 'games') === 0) return { ok: false, status: response.status, error: 'zero-games' };
  return {
    ok: true,
    player: {
      name: player.name,
      team: player.team,
      games: number(row, 'games'),
      disposals: number(row, 'disposals'),
      kicks: number(row, 'kicks'),
      handballs: number(row, 'handballs'),
      marks: number(row, 'marks'),
      goals: number(row, 'goals_num') || number(row, 'goals'),
      tackles: number(row, 'tackles'),
      clearances: number(row, 'clearances'),
      inside_50s: number(row, 'inside_50s'),
      rebound_50s: number(row, 'rebound_50s'),
      contested_possessions: number(row, 'contested_poss'),
      uncontested_possessions: number(row, 'uncontested_poss'),
      meters_gained: number(row, 'metres_gained'),
      free_kicks_for: number(row, 'frees_for'),
    },
  };
}

function keepExisting(reason: string): never {
  if (!fs.existsSync(file)) throw new Error(reason);
  console.warn(`${reason}; keeping existing ${file}`);
  process.exit(0);
}

function tally(failures: Array<Extract<Attempt, { ok: false }>>) {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    const key = `${failure.status}:${failure.error}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, count]) => `${count}× ${key}`)
    .join('; ');
}

async function main() {
  const seeds = (seed.players || []).filter((player) => player.name);
  const probeSlug = footyinfoPlayerSlug(seeds[0]?.name || '') || 'nick-daicos';
  const probe = await fetchFootyinfoJson<Summary>(
    `/player/${encodeURIComponent(probeSlug)}/game_logs_summary?mode=averages&columns=all`,
    { attempts: 1 }
  );
  if (!probe.ok) {
    keepExisting(`FootyInfo probe failed for ${probeSlug} (HTTP ${probe.status}: ${probe.error})`);
  }
  const output: Attempt[] = new Array(seeds.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < seeds.length) {
      const index = cursor++;
      output[index] = await one(seeds[index]).catch((error): Attempt => ({
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }));
  const players = output.filter((item): item is Extract<Attempt, { ok: true }> => item.ok).map((item) => item.player);
  const failures = output.filter((item): item is Extract<Attempt, { ok: false }> => !item.ok);
  if (players.length < Math.min(50, seeds.length * 0.5)) {
    keepExisting(
      `FootyInfo returned only ${players.length}/${seeds.length} player season summaries (${tally(failures) || 'no failure detail'}); refusing to replace data`
    );
  }
  const payload = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'footyinfo.com',
    sourcePage: 'player/{slug}/game_logs_summary?mode=averages&columns=all',
    playerCount: players.length,
    advancedStatsComplete: true,
    players,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${file} (${players.length}/${seeds.length} FootyInfo players)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
