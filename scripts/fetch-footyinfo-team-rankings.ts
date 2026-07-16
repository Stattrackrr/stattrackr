#!/usr/bin/env tsx
/**
 * Build existing TA/OA team-ranking files exclusively from FootyInfo.
 * Current-round previews provide canonical team season averages/ranks; player
 * game logs provide the complementary "allowed" totals for opponent averages.
 */
import fs from 'fs';
import path from 'path';
import { fetchFootyInfoPlayerGameLogs } from '../lib/afl/footyinfoPlayer';
import { fetchFootyinfoRoundSummary } from '../lib/afl/footyinfoLeague';
import { fetchFootyinfoJson } from '../lib/afl/footyinfoHttp';
import { footyinfoNameToOfficial, officialToNickname } from '../lib/afl/footyinfoTeamMapping';
import { footywireNicknameToOfficial } from '../lib/aflTeamMapping';

type LeaguePlayer = { name: string; team: string };
type PreviewRow = { key: string; home: { avg: number; rank: number }; away: { avg: number; rank: number } };
type Preview = { teamStats?: { stats?: PreviewRow[] } };
type Totals = Record<string, number>;

const season = Number(process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) || new Date().getFullYear());
const concurrency = Math.max(1, Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.slice(14) || 6));
const league = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`), 'utf8')) as { players?: LeaguePlayer[] };
const fields = ['K', 'HB', 'D', 'G', 'M', 'T', 'CL', 'I50', 'R50', 'CP', 'UP', 'MG'] as const;
const gameValue: Record<(typeof fields)[number], string> = {
  K: 'kicks', HB: 'handballs', D: 'disposals', G: 'goals', M: 'marks', T: 'tackles',
  CL: 'clearances', I50: 'inside_50s', R50: 'rebounds', CP: 'contested_possessions',
  UP: 'uncontested_possessions', MG: 'meters_gained',
};
const previewValue: Record<string, (typeof fields)[number]> = {
  disposals: 'D', marks: 'M', tackles: 'T', clearances: 'CL', inside_50s: 'I50',
  rebound_50s: 'R50', contested_possessions: 'CP',
};
const empty = (): Totals => Object.fromEntries(fields.map((field) => [field, 0]));
const totalByTeam = new Map<string, Totals>();
const allowedByOpponent = new Map<string, Totals>();
const matchesByTeam = new Map<string, Set<string>>();
const matchesByOpponent = new Map<string, Set<string>>();
const previewByTeam = new Map<string, Record<string, number>>();
const matchIds = new Set<number>();

function official(value: string) {
  return footyinfoNameToOfficial(value) || footywireNicknameToOfficial(value) || value;
}
function add(map: Map<string, Totals>, team: string, game: Record<string, unknown>) {
  const totals = map.get(team) || empty();
  for (const field of fields) totals[field] += Number(game[gameValue[field]]) || 0;
  map.set(team, totals);
}
function remember(map: Map<string, Set<string>>, team: string, id: string) {
  const values = map.get(team) || new Set<string>();
  values.add(id);
  map.set(team, values);
}

const matchValue: Record<(typeof fields)[number], string> = {
  K: 'k', HB: 'h', D: 'd', G: 'f', M: 'm', T: 't', CL: 'cl', I50: 'i',
  R50: 'r', CP: 'cp', UP: 'up', MG: 'mi',
};

function addMatchStats(map: Map<string, Totals>, team: string, stats: Record<string, unknown>) {
  const totals = map.get(team) || empty();
  for (const field of fields) totals[field] += Number(stats[matchValue[field]]) || 0;
  map.set(team, totals);
}

async function loadPreviews() {
  const matches = await fetchFootyinfoRoundSummary(season, 166);
  if (matches.length !== 9) throw new Error(`Expected 9 current AFL premiership matches; received ${matches.length}`);
  await Promise.all(matches.map(async (match) => {
    const response = await fetchFootyinfoJson<Preview>(`/match/${match.id}/preview`);
    if (!response.ok || !response.data.teamStats?.stats?.length) throw new Error(`Missing team preview for match ${match.id}`);
    const sides: Array<[string, 'home' | 'away']> = [
      [official(match.home_team_full || match.home_team), 'home'],
      [official(match.away_team_full || match.away_team), 'away'],
    ];
    for (const [team, side] of sides) {
      const values = previewByTeam.get(team) || {};
      for (const row of response.data.teamStats.stats) {
        const field = previewValue[row.key];
        if (field) values[field] = Number(row[side]?.avg) || 0;
      }
      previewByTeam.set(team, values);
    }
  }));
}

async function loadGameTotals() {
  const players = (league.players || []).filter((player) => player.name && player.team);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < players.length) {
      const player = players[cursor++];
      const logs = await fetchFootyInfoPlayerGameLogs(player.name, season, player.team).catch(() => null);
      for (const game of logs?.games || []) {
        const id = Number(String(game.match_url || '').match(/-(\d+)$/)?.[1]);
        if (Number.isFinite(id) && id > 0) matchIds.add(id);
      }
    }
  }));
  await Promise.all([...matchIds].map(async (id) => {
    const response = await fetchFootyinfoJson<{ h_name?: string; a_name?: string; hs?: Record<string, unknown>; as?: Record<string, unknown> }>(`/match/${id}`);
    if (!response.ok || !response.data.h_name || !response.data.a_name || !response.data.hs || !response.data.as) return;
    const home = official(response.data.h_name);
    const away = official(response.data.a_name);
    addMatchStats(totalByTeam, home, response.data.hs);
    addMatchStats(totalByTeam, away, response.data.as);
    addMatchStats(allowedByOpponent, home, response.data.as);
    addMatchStats(allowedByOpponent, away, response.data.hs);
    remember(matchesByTeam, home, String(id));
    remember(matchesByTeam, away, String(id));
    remember(matchesByOpponent, home, String(id));
    remember(matchesByOpponent, away, String(id));
  }));
}

function toRows(type: 'ta' | 'oa') {
  const totals = type === 'ta' ? totalByTeam : allowedByOpponent;
  const matches = type === 'ta' ? matchesByTeam : matchesByOpponent;
  return [...previewByTeam.keys()].map((team) => {
    const games = matches.get(team)?.size || 0;
    const calculated = totals.get(team) || empty();
    const preview = previewByTeam.get(team) || {};
    const stats: Record<string, number | string> = { Team: officialToNickname(team) || team, Gm: games };
    for (const field of fields) {
      // Preview is the authoritative season-average surface for team averages;
      // opponent averages are calculated from the same FootyInfo game logs.
      stats[field] = type === 'ta' && preview[field] != null
        ? preview[field]
        : games ? Number((calculated[field] / games).toFixed(2)) : 0;
    }
    return { rank: 0, team: stats.Team as string, stats };
  }).sort((a, b) => Number(b.stats.D) - Number(a.stats.D)).map((row, index) => ({
    ...row, rank: index + 1, stats: { ...row.stats, Rk: index + 1 },
  }));
}

async function main() {
  await loadPreviews();
  await loadGameTotals();
  if (previewByTeam.size !== 18) throw new Error(`Preview coverage incomplete: ${previewByTeam.size}/18 teams`);
  const opponentCoverage = [...previewByTeam.keys()].filter((team) => (matchesByOpponent.get(team)?.size || 0) > 0);
  if (opponentCoverage.length !== 18) {
    throw new Error(`Opponent game-log coverage incomplete: ${opponentCoverage.length}/18 teams`);
  }
  const labels: Record<string, string> = {
    Rk: 'Rank', Gm: 'Games', K: 'Kicks', HB: 'Handballs', D: 'Disposals', G: 'Goals',
    M: 'Marks', T: 'Tackles', CL: 'Clearances', I50: 'Inside 50s', R50: 'Rebound 50s',
    CP: 'Contested Possessions', UP: 'Uncontested Possessions', MG: 'Meters Gained',
  };
  for (const type of ['ta', 'oa'] as const) {
    const output = {
      season, type, generatedAt: new Date().toISOString(), source: 'footyinfo.com',
      sourcePage: 'match/{id}/preview + player/{slug}/game_logs',
      teamCount: 18, statColumns: ['Rk', 'Team', 'Gm', ...fields], statLabels: labels, teams: toRows(type),
    };
    const file = path.join(process.cwd(), 'data', `afl-team-rankings-${season}-${type}.json`);
    fs.writeFileSync(file, JSON.stringify(output, null, 2));
    console.log(`Wrote ${file} (${output.teams.length} FootyInfo teams)`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
