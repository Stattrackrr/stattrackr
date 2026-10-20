/**
 * How good are RotoWire's NBA lineup predictions? Reads the Redis log written by the
 * log-nba-lineups cron and compares it with actual starters (BallDontLie lineups) and minutes
 * played (nba_player_game_stats). Read-only.
 *
 *   node --env-file=.env.local --import tsx scripts/nba-lineups-report.ts [--days 14]
 */

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import sharedCache from '@/lib/sharedCache';
import { nbaRosterEntry, resolveNbaBoardName, type NbaRosterEntry } from '@/lib/aiPicks/candidates/nba';
import { getNbaClubByCode } from '@/lib/nba/dash/teams';
import { rotowireDayKey, type RwDayLog, type RwPlayer, type RwTeamSnapshot } from '@/lib/nba/rotowireLineups';

const BDL_KEY = String(process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '')
  .replace(/^Bearer\s+/i, '')
  .trim();
const CHECKPOINTS: Array<[string, number]> = [
  ['6h before', 6 * 60],
  ['3h before', 3 * 60],
  ['1h before', 60],
  ['30m before', 30],
  ['last pre-tip', 0],
];

type LineupRow = { starter: boolean; player: { id: number; first_name: string; last_name: string }; team: { abbreviation: string } };
type Bucket = { n: number; hit: number };

const daysArg = Number(process.argv[process.argv.indexOf('--days') + 1]);
const DAYS = process.argv.includes('--days') && daysArg > 0 ? daysArg : 14;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pct = (b: Bucket) => (b.n ? `${Math.round((100 * b.hit) / b.n)}%` : '-');
const add = (m: Map<string, Bucket>, k: string, hit: boolean) => {
  const b = m.get(k) ?? { n: 0, hit: 0 };
  b.n++;
  if (hit) b.hit++;
  m.set(k, b);
};
const code = (abbr: string) => getNbaClubByCode(abbr)?.code ?? abbr;

async function bdlLineups(gameId: number): Promise<LineupRow[]> {
  const res = await fetch(`https://api.balldontlie.io/v1/lineups?game_ids[]=${gameId}&per_page=100`, { headers: { Authorization: BDL_KEY } });
  if (!res.ok) throw new Error(`BDL lineups ${gameId}: HTTP ${res.status}`);
  return ((await res.json()) as { data?: LineupRow[] }).data ?? [];
}

/** The snapshot RotoWire was showing `minutesBefore` tip (null if it had not been logged yet). */
function inEffect(snaps: RwTeamSnapshot[], tipMs: number, minutesBefore: number): RwTeamSnapshot | null {
  const cut = tipMs - minutesBefore * 60_000;
  let hit: RwTeamSnapshot | null = null;
  for (const s of snaps) if (Date.parse(s.at) <= cut) hit = s;
  return hit;
}

async function main() {
  const now = Date.now();
  const dates = Array.from({ length: DAYS + 1 }, (_, i) => isoDay(now - (DAYS - i) * 86_400_000));
  const logs = (await sharedCache.getJSONMany<RwDayLog>(dates.map(rotowireDayKey))).filter((l): l is RwDayLog => !!l);
  if (!logs.length) {
    console.log(`No RotoWire lineup logs in the last ${DAYS} days.`);
    process.exit(0);
  }

  const { data: teams } = await supabaseAdmin.from('nba_teams').select('id, abbreviation');
  const teamCode = new Map((teams ?? []).map((t) => [Number(t.id), code(String(t.abbreviation))]));
  const { data: games } = await supabaseAdmin
    .from('nba_games')
    .select('id, game_date, status_state, home_team_id, visitor_team_id')
    .in('game_date', logs.map((l) => l.date));
  const gameFor = new Map(
    (games ?? []).map((g) => [`${g.game_date}|${teamCode.get(Number(g.visitor_team_id))}@${teamCode.get(Number(g.home_team_id))}`, g])
  );
  const { data: players } = await supabaseAdmin.from('nba_players').select('id, full_name, team_id').not('team_id', 'is', null);
  const rosterByTeam = new Map<string, NbaRosterEntry[]>();
  for (const p of players ?? []) {
    const c = teamCode.get(Number(p.team_id));
    if (c) rosterByTeam.set(c, [...(rosterByTeam.get(c) ?? []), nbaRosterEntry(String(p.id), String(p.full_name))]);
  }

  const starters = new Map<string, { teams: number; correct: number; perfect: number }>();
  const byKind = new Map<string, { teams: number; correct: number; perfect: number }>();
  const tags = new Map<string, Bucket>();
  const pcts = new Map<string, Bucket>();
  const misses: string[] = [];
  const unmatched = new Set<string>();
  let graded = 0;
  let pending = 0;

  for (const log of logs) {
    for (const [id, g] of Object.entries(log.games)) {
      const row = gameFor.get(`${log.date}|${id}`);
      const tipMs = g.tipAt ? Date.parse(g.tipAt) : NaN;
      if (!row || row.status_state !== 'final' || !Number.isFinite(tipMs)) {
        pending++;
        continue;
      }
      const lineup = await bdlLineups(Number(row.id));
      if (!lineup.length) {
        pending++;
        continue;
      }
      const { data: box } = await supabaseAdmin
        .from('nba_player_game_stats')
        .select('player_id, minutes')
        .eq('game_id', Number(row.id))
        .eq('period', 0);
      const minutes = new Map((box ?? []).map((b) => [String(b.player_id), Number(b.minutes) || 0]));

      for (const [team, snaps] of Object.entries(g.teams)) {
        const rows = lineup.filter((r) => code(r.team.abbreviation) === team);
        const actual = new Set(rows.filter((r) => r.starter).map((r) => String(r.player.id)));
        if (actual.size !== 5) continue;
        graded++;
        const roster = [
          ...rows.map((r) => nbaRosterEntry(String(r.player.id), `${r.player.first_name} ${r.player.last_name}`)),
          ...(rosterByTeam.get(team) ?? []),
        ];
        const idOf = (p: RwPlayer) => {
          const pid = resolveNbaBoardName(p.name, roster);
          if (!pid) unmatched.add(`${p.name} (${team})`);
          return pid;
        };

        for (const [label, before] of CHECKPOINTS) {
          const snap = before ? inEffect(snaps, tipMs, before) : snaps[snaps.length - 1]!;
          if (!snap) continue;
          const correct = snap.starters.filter((p) => actual.has(idOf(p) ?? '')).length;
          const s = starters.get(label) ?? { teams: 0, correct: 0, perfect: 0 };
          s.teams++;
          s.correct += correct;
          if (correct === 5) s.perfect++;
          starters.set(label, s);
          if (before) continue;

          const kind = snap.confirmed ? 'confirmed' : 'expected';
          const k = byKind.get(kind) ?? { teams: 0, correct: 0, perfect: 0 };
          k.teams++;
          k.correct += correct;
          if (correct === 5) k.perfect++;
          byKind.set(kind, k);

          if (correct < 5) {
            const predicted = new Set(snap.starters.map((p) => idOf(p)));
            const wrong = snap.starters.filter((p) => !actual.has(idOf(p) ?? '')).map((p) => `${p.name} (${Math.round(minutes.get(idOf(p) ?? '') ?? 0)} min)`);
            const instead = rows.filter((r) => r.starter && !predicted.has(String(r.player.id))).map((r) => `${r.player.first_name} ${r.player.last_name}`);
            misses.push(`${log.date} ${team} [${kind}]: had ${wrong.join(', ')}; started ${instead.join(', ')}`);
          }
          for (const p of [...snap.starters, ...snap.mayNotPlay]) {
            const pid = idOf(p);
            if (!pid) continue;
            const played = (minutes.get(pid) ?? 0) > 0;
            if (p.tag) add(tags, p.tag, played);
            if (p.playPct != null) add(pcts, `${p.playPct}%`, played);
          }
        }
      }
    }
  }

  console.log(`RotoWire lineup check, ${logs[0]!.date} to ${logs[logs.length - 1]!.date}: ${graded} team-games graded, ${pending} games pending\n`);
  console.log('Predicted starters who actually started (out of 5):');
  for (const [label] of CHECKPOINTS) {
    const s = starters.get(label);
    if (s) console.log(`  ${label.padEnd(13)} avg ${(s.correct / s.teams).toFixed(2)}  all five ${Math.round((100 * s.perfect) / s.teams)}%  (${s.teams} team-games)`);
  }
  for (const [kind, k] of byKind) {
    console.log(`  ${kind.padEnd(13)} avg ${(k.correct / k.teams).toFixed(2)}  all five ${Math.round((100 * k.perfect) / k.teams)}%  (${k.teams} team-games, last pre-tip)`);
  }
  console.log('\nInjury tags (last pre-tip): played in the game');
  for (const [tag, b] of [...tags].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${tag.padEnd(6)} ${pct(b).padStart(4)}  (${b.hit}/${b.n})`);
  console.log('\nChance-to-play bucket (last pre-tip): played in the game');
  for (const [p, b] of [...pcts].sort((a, b) => Number.parseInt(b[0]) - Number.parseInt(a[0]))) console.log(`  ${p.padEnd(5)} ${pct(b).padStart(4)}  (${b.hit}/${b.n})`);
  if (misses.length) {
    console.log(`\nWrong starter calls (last pre-tip), ${misses.length}:`);
    for (const m of misses.slice(-40)) console.log(`  ${m}`);
  }
  if (unmatched.size) console.log(`\nNames not matched to a BallDontLie player: ${[...unmatched].join(', ')}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
