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

async function one(player: Seed) {
  const slug = footyinfoPlayerSlug(player.name || '');
  if (!slug) return null;
  const response = await fetchFootyinfoJson<Summary>(`/player/${encodeURIComponent(slug)}/game_logs_summary?mode=averages&columns=all`);
  const league = response.data?.leagues?.find((item) => item.competition_type_id === 1);
  const row = league?.game_logs_summary?.rows?.find((item) => text(item, 'season') === String(season));
  if (!response.ok || !row || number(row, 'games') === 0) return null;
  return {
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
  };
}

async function main() {
  const seeds = (seed.players || []).filter((player) => player.name);
  const output: Array<Awaited<ReturnType<typeof one>>> = new Array(seeds.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < seeds.length) {
      const index = cursor++;
      output[index] = await one(seeds[index]).catch(() => null);
    }
  }));
  const players = output.filter(Boolean);
  if (players.length < Math.min(50, seeds.length * 0.5)) {
    throw new Error(`FootyInfo returned only ${players.length}/${seeds.length} player season summaries; refusing to replace data`);
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
