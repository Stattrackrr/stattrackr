/**
 * Sync NBA dashboard data from BallDontLie (GOAT) into Supabase nba_* tables.
 * The Vercel cron (`/api/cron/sync-nba-bdl`) runs the incremental sync; use this for backfills.
 *
 *   npx tsx scripts/sync-nba-bdl.ts                       # current season, last 3 days
 *   npx tsx scripts/sync-nba-bdl.ts --seasons=2023,2024,2025 --full
 *   npx tsx scripts/sync-nba-bdl.ts --jobs=injuries,games --dry-run
 *
 * Jobs: teams, players, games, stats, advanced, plays, lineups, injuries, standings, averages,
 *       shotsummary (aggregates stored nba_shots for the dashboard; reads Supabase, not BDL)
 * --full        stats/advanced/lineups for whole seasons instead of the last --days
 * --days=N      incremental window (default 3); --since/--until=YYYY-MM-DD pin it
 * --max-games=N cap play-by-play games per run (default 400)
 * --rpm=N       BDL requests per minute (default 360; the live site shares the key)
 * --dry-run     fetch and map, write nothing
 */
import { runNbaBdlSync, type NbaSyncJob } from '../lib/nba/sync/bdlSync';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true';
}

const num = (v: string | undefined) => (v == null ? undefined : Number(v));

runNbaBdlSync({
  jobs: arg('jobs')?.split(',').map((j) => j.trim()) as NbaSyncJob[] | undefined,
  seasons: arg('seasons')?.split(',').map(Number).filter(Number.isFinite),
  full: arg('full') === 'true',
  days: num(arg('days')),
  since: arg('since'),
  until: arg('until'),
  maxGames: num(arg('max-games')),
  rpm: num(arg('rpm')),
  dryRun: arg('dry-run') === 'true',
})
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failures.length) process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
