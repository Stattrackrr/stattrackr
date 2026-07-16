#!/usr/bin/env tsx
/**
 * Validate every player in the committed FootyInfo league snapshot.
 * Checks both season-summary coverage and normalized per-game core stats.
 */
import fs from 'fs';
import path from 'path';
import { fetchFootyInfoPlayerGameLogs } from '../lib/afl/footyinfoPlayer';
import { fetchFootyinfoPlayerSeasonAverages } from '../lib/afl/footyinfoLeague';
import { footyinfoPlayerSlug } from '../lib/afl/footyinfoTeamMapping';

type Player = { name: string; team: string; games: number; disposals: number; tackles: number };

const season = Number(process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) || new Date().getFullYear());
const concurrency = Math.max(1, Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.slice(14) || 6));
const limit = Math.max(0, Number(process.argv.find((arg) => arg.startsWith('--limit='))?.slice(8) || 0));
const file = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as { source?: string; players?: Player[] };
const players = (payload.players || []).slice(0, limit || undefined);

type Failure = { player: string; reason: string };
const failures: Failure[] = [];
let summaryOk = 0;
let logsOk = 0;
let cursor = 0;

async function validate(player: Player) {
  const slug = footyinfoPlayerSlug(player.name);
  const summary = await fetchFootyinfoPlayerSeasonAverages(slug, season);
  if (!summary || summary.games <= 0) {
    failures.push({ player: player.name, reason: 'missing FootyInfo season summary' });
    return;
  }
  summaryOk++;
  const logs = await fetchFootyInfoPlayerGameLogs(player.name, season, player.team);
  const games = logs?.games || [];
  if (!games.length) {
    failures.push({ player: player.name, reason: 'missing normalized game logs' });
    return;
  }
  if (games.some((game) => !game.date || !Number.isFinite(game.disposals) || !Number.isFinite(game.tackles))) {
    failures.push({ player: player.name, reason: 'game log missing date, disposals, or tackles' });
    return;
  }
  logsOk++;
}

async function main() {
  if (payload.source !== 'footyinfo.com') throw new Error(`Expected FootyInfo snapshot; received ${payload.source || 'unknown'}`);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < players.length) {
      const index = cursor++;
      await validate(players[index]).catch((error) => {
        failures.push({ player: players[index].name, reason: error instanceof Error ? error.message : String(error) });
      });
    }
  }));
  const report = { season, total: players.length, summaryOk, logsOk, failures };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
