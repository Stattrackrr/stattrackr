/**
 * Precompute the World Cup / international Opponent Breakdown rankings and store
 * them in the permanent `world_cup_cache` table, one entry per window (L5 / L10
 * / All). Each nation's defensive "allowed averages" are computed over their
 * most recent N completed games across EVERY competition we ingest (BDL World
 * Cup + StatsBomb / API-Football / SofaScore internationals). The "All" window
 * (id 0) averages over every game we have for a nation.
 *
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --bdl-cache
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --bdl-cache --incremental
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --bdl-cache --step=4
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --bdl-cache --force --step=4
 *   npm run build:world-cup:bdl-cache -- --step=4 --force
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --dashboard-warm
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --refresh-odds
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --trigger-odds-api
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --warm-props-stats
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --rebuild-enriched-only
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --full-pipeline
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --diagnose-props-dvp
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --diagnose-props-dvp --player="Lamine Yamal"
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --inspect-team netherlands
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --inspect-team netherlands --all-keys
 *   npm run debug:wc:opp-breakdown
 *   npm run debug:wc:opp-breakdown -- --team norway --verbose
 *   npm run build:world-cup:dashboard
 */
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

const ENV_FILES = ['.env.local', '.env.development.local', '.env'];
for (const file of ENV_FILES) {
  const fullPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(fullPath)) config({ path: fullPath, override: false });
}

async function runDashboardWarm(argv: string[]): Promise<void> {
  const full = argv.includes('--full');
  const withPhotos = argv.includes('--with-photos');
  const skipPhotos = argv.includes('--skip-photos');
  const skipIntl = argv.includes('--skip-intl');
  const skipTeamDashboards = argv.includes('--skip-team-dashboards');
  const skipCachedTeams = argv.includes('--skip-cached-teams');
  const skipPlayerDashboards = argv.includes('--skip-player-dashboards');
  const liveOddsPlayerOnly = argv.includes('--live-odds-player-only');
  const dryRun = argv.includes('--dry-run');

  function passThroughFlags(): string[] {
    const out: string[] = [];
    if (full) out.push('--force');
    else out.push('--incremental');
    if (dryRun) out.push('--dry-run');
    for (const arg of argv) {
      if (arg.startsWith('--step=')) out.push(arg);
    }
    return out;
  }

  async function phase(label: string, fn: () => Promise<void>): Promise<void> {
    console.log(`\n${'='.repeat(72)}\n[wc-dashboard] ${label}\n${'='.repeat(72)}`);
    const started = Date.now();
    await fn();
    console.log(`[wc-dashboard] ${label} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const mode = full ? 'FULL rebuild' : 'INCREMENTAL update';
  console.log(`[wc-dashboard] Starting World Cup dashboard cache build (${mode})`);
  if (dryRun) console.log('[wc-dashboard] DRY RUN — no Supabase writes');

  const bdlFlags = passThroughFlags();

  await phase('Phase 1/6 — BDL core + match details + WC side panels (steps 1–10)', async () => {
    const { runBuildWorldCup2026Cache } = await import('../lib/worldCupOpponentBreakdown');
    await runBuildWorldCup2026Cache(bdlFlags);
  });

  if (!skipIntl) {
    await phase('Phase 2/6 — International DvP (DEF/MID/ATT × L5/L10/All)', async () => {
      const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
      const { refreshWorldCupDvpCache, WC_DVP_POSITIONS, WC_DVP_WINDOWS } = await import(
        '../lib/internationalDashboard'
      );
      const { loadWorldCupQualifiedSlugs } = await import('../lib/worldCupOpponentBreakdown');
      const label = (w: number) => (w === 0 ? 'All' : `L${w}`);
      console.log(
        `[dvp] ${WC_DVP_POSITIONS.length} positions × ${WC_DVP_WINDOWS.length} windows (${WC_DVP_WINDOWS.map(label).join('/')})`
      );
      const qualifiedSlugs = await loadWorldCupQualifiedSlugs(apiKey);
      const { entries, teams } = await refreshWorldCupDvpCache(
        (msg) => console.log(`[dvp] ${msg}`),
        qualifiedSlugs
      );
      console.log(`[dvp] cached ${entries} entries across ${teams} nations`);
    });

    await phase('Phase 3/6 — International Opponent Breakdown (L5/L10/All)', async () => {
      const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
      const { refreshOpponentBreakdownCache, OPP_BREAKDOWN_WINDOWS, OPP_BREAKDOWN_ALL_WINDOW } = await import(
        '../lib/worldCupOpponentBreakdown'
      );
      const label = (w: number) => (w === OPP_BREAKDOWN_ALL_WINDOW ? 'All' : `L${w}`);
      const all = await refreshOpponentBreakdownCache(apiKey);
      for (const window of OPP_BREAKDOWN_WINDOWS) {
        const payload = all[window];
        console.log(`[opp-breakdown] ${label(window)}: ${Object.keys(payload.names).length} nations`);
      }
    });
  } else {
    console.log('\n[wc-dashboard] Skipping international DvP + Opponent Breakdown (--skip-intl)');
  }

  if (argv.some((a) => a.startsWith('--step=')) && !argv.find((a) => a === '--step=10')) {
    await phase('Phase 4/6 — Player search index', async () => {
      const { rebuildAndPersistWorldCupPlayerIndex } = await import('../lib/worldCupPlayerIndex');
      const result = await rebuildAndPersistWorldCupPlayerIndex({ log: (msg) => console.log(`[player-index] ${msg}`) });
      console.log(`[player-index] ${result.count} players (persisted=${result.persisted})`);
    });
  } else {
    console.log('\n[wc-dashboard] Player index built in Phase 1 step 10');
  }

  if (!skipTeamDashboards && !dryRun) {
    await phase('Phase 5/6 — Team + Player dashboards (fixtures, side panels, team share)', async () => {
      const { warmWorldCupTeamDashboardCaches } = await import('../lib/worldCupOpponentBreakdown');
      const result = await warmWorldCupTeamDashboardCaches({
        incremental: skipCachedTeams,
        skipPlayerDashboards,
        liveOddsPlayerOnly,
        log: (msg) => console.log(msg),
      });
      if (result.failed && !result.warmed) process.exitCode = 1;
    });
  } else if (skipTeamDashboards) {
    console.log('\n[wc-dashboard] Skipping team dashboards (--skip-team-dashboards)');
  }

  if (withPhotos && !skipPhotos && !dryRun) {
    await phase('Phase 6/6 — Lineup squad photos', async () => {
      const { buildWorldCupSquadPhotoCaches } = await import('../lib/worldCupPlayerIndex');
      const result = await buildWorldCupSquadPhotoCaches({ log: (msg) => console.log(msg) });
      console.log(`[squad-photos] warmed ${result.warmed}, skipped ${result.skipped}`);
    });
  } else if (skipPhotos) {
    console.log('\n[wc-dashboard] Skipping squad photos (--skip-photos)');
  } else if (!withPhotos) {
    console.log('\n[wc-dashboard] Skipping squad photos (pass --with-photos to include)');
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('[wc-dashboard] All phases complete. Hard-refresh /world-cup to load new data.');
  console.log(`${'='.repeat(72)}\n`);
}

async function runTriggerWorldCupOddsApi(): Promise<void> {
  const baseUrl = (process.env.BASE_URL || process.env.PROD_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
  const secret = String(process.env.CRON_SECRET || '').trim();
  const secretQs = secret ? `&secret=${encodeURIComponent(secret)}` : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers['X-Cron-Secret'] = secret;
  }

  const candidates = [
    `${baseUrl}/api/world-cup/dashboard?oddsRefresh=1${secretQs}`,
    `${baseUrl}/api/world-cup/dashboard?playerPropsList=1&refresh=1${secretQs}`,
  ];

  let res: Response | null = null;
  let data: Record<string, unknown> = {};
  let usedUrl = '';

  for (const refreshUrl of candidates) {
    const isDashboardFallback = refreshUrl.includes('playerPropsList=1');
    console.log('[wc-trigger] Calling', refreshUrl);
    if (isDashboardFallback) {
      console.log(
        '[wc-trigger] Waiting for production (often 1–3 min; up to 5 min on older deploys without fast cron enrich)...'
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);
    try {
      res = await fetch(refreshUrl, { signal: controller.signal, headers });
      data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      usedUrl = refreshUrl;
      console.log('[wc-trigger] HTTP', res.status);
      if (res.ok) break;
      if (res.status === 404) {
        console.log('[wc-trigger] Route not deployed yet, trying fallback...');
        res = null;
        continue;
      }
      break;
    } catch (err) {
      console.error('[wc-trigger] Request failed:', err instanceof Error ? err.message : String(err));
      console.error('[wc-trigger] Is the dev server running (npm run dev) for localhost?');
      process.exitCode = 1;
      return;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!res?.ok) {
    console.log(JSON.stringify(data, null, 2));
    if (res?.status === 404) {
      console.error(
        '[wc-trigger] No refresh route on this deployment. Deploy latest code or run: npm run refresh:world-cup:odds'
      );
    }
    process.exitCode = 1;
    return;
  }

  const propsCount =
    typeof data.propsCount === 'number'
      ? data.propsCount
      : typeof data.propsCount === 'undefined' && typeof data.data !== 'undefined'
        ? Array.isArray(data.data)
          ? data.data.length
          : 0
        : null;
  const gamesCount =
    typeof data.gamesCount === 'number'
      ? data.gamesCount
      : typeof data.games === 'undefined'
        ? null
        : Array.isArray(data.games)
          ? data.games.length
          : 0;
  const lastUpdated = typeof data.lastUpdated === 'string' ? data.lastUpdated : null;
  const ingestMessage = typeof data.ingestMessage === 'string' ? data.ingestMessage : null;
  const looksLikePropsList =
    Array.isArray(data.data) || Array.isArray(data.games) || typeof data.propsCount === 'number';

  if (!looksLikePropsList) {
    console.error(
      '[wc-trigger] HTTP 200 but response is not a player props list (missing games/data).'
    );
    console.error(
      '[wc-trigger] Production may not have playerPropsList=1 deployed yet — deploy latest code, then retry.'
    );
    if (process.argv.includes('--verbose')) {
      console.log(JSON.stringify(data, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  console.log('[wc-trigger] Refresh OK');
  console.log(`[wc-trigger] games=${gamesCount ?? '?'} props=${propsCount ?? '?'}`);
  if (lastUpdated) console.log(`[wc-trigger] lastUpdated=${lastUpdated}`);
  if (ingestMessage) console.log(`[wc-trigger] ${ingestMessage}`);
  if ((propsCount ?? 0) === 0) {
    console.warn('[wc-trigger] Zero props in response — props page will stay empty until fixtures have markets.');
  }
  if (process.argv.includes('--verbose')) {
    console.log(JSON.stringify(data, null, 2));
  }

  if (!usedUrl.includes('playerPropsList=1')) {
    const listRes = await fetch(`${baseUrl}/api/world-cup/dashboard?playerPropsList=1`, {
      cache: 'no-store',
      headers,
    });
    const listData = (await listRes.json().catch(() => ({}))) as { games?: unknown[]; data?: unknown[] };
    const games = Array.isArray(listData.games) ? listData.games.length : 0;
    const rows = Array.isArray(listData.data) ? listData.data.length : 0;
    console.log(`[wc-trigger] List check: games=${games} props=${rows}`);
  }

  console.log('[wc-trigger] Done. Reload /props?sport=world-cup');
}

async function runRefreshOdds(): Promise<void> {
  const { refreshWorldCupOddsCache } = await import('../lib/worldCupCache');

  console.log('[wc-odds] Refreshing World Cup props list (API-Football)...');
  console.log('[wc-odds] odds list cache backend: Supabase world_cup_cache');
  const result = await refreshWorldCupOddsCache();
  console.log(`[wc-odds] games=${result.gamesCount} props=${result.propsCount}`);
  if (result.ingestMessage) console.log(`[wc-odds] ${result.ingestMessage}`);
  if (!result.success) {
    console.error('[wc-odds] Refresh failed:', result.error);
    process.exit(1);
  }
  if (!result.propsCount) {
    console.warn('[wc-odds] No props returned. Check API_FOOTBALL_KEY and fixtures in the next 36h.');
  } else {
    console.log(`[wc-odds] Odds list cache written (${result.propsCount} rows; stats warm in Phase 4)`);
  }
}

async function runRebuildEnrichedOnly(): Promise<void> {
  const { rebuildWorldCupEnrichedListFromOddsCache } = await import('../lib/worldCupCache');
  const { warmCombinedPropsSnapshot } = await import('../lib/combinedPropsSnapshot');

  console.log('[wc-rebuild] Rebuilding enriched props from existing odds + stat caches (skipping stat warm)...');
  const rebuilt = await rebuildWorldCupEnrichedListFromOddsCache({
    cacheOnly: true,
    skipRowMeta: false,
    writeCache: true,
  });
  console.log(
    `[wc-rebuild] Enriched cache written (${rebuilt.data.length} enriched rows, ${rebuilt.rawOddsCount} odds rows)`
  );

  try {
    const baseUrl = (process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    console.log('[wc-rebuild] Warming combined props snapshot cache...');
    const snapshot = await warmCombinedPropsSnapshot({
      origin: baseUrl,
      cronSecret: cronSecret || undefined,
    });
    console.log(
      `[wc-rebuild] Combined props snapshot written (wc=${snapshot.worldCup.props.length} props, afl=${snapshot.afl.props.length} props)`
    );
  } catch (e) {
    console.warn('[wc-rebuild] combined props snapshot warm failed:', e);
  }
}

async function runWarmPropsStats(argv: string[]): Promise<void> {
  if (argv.includes('--rebuild-enriched-only')) {
    await runRebuildEnrichedOnly();
    return;
  }

  const {
    runWorldCupPropsStatsWarm,
    rebuildWorldCupEnrichedListFromOddsCache,
  } = await import('../lib/worldCupCache');
  const { warmCombinedPropsSnapshot } = await import('../lib/combinedPropsSnapshot');

  const baseUrl = (process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
  const useListApi = process.env.WC_WARM_USE_LIST === '1';
  console.log('[wc-warm] odds/enriched list cache backend: Supabase world_cup_cache');
  console.log(`[wc-warm] Warming props stats (useListApi=${useListApi})...`);
  const result = await runWorldCupPropsStatsWarm(baseUrl, { useListApi });
  console.log('[wc-warm]', JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);

  try {
    console.log('[wc-warm] Rebuilding enriched props cache from odds + warmed stats...');
    const rebuilt = await rebuildWorldCupEnrichedListFromOddsCache({
      cacheOnly: true,
      skipRowMeta: false,
      writeCache: true,
    });
    console.log(
      `[wc-warm] Enriched cache written (${rebuilt.data.length} props with stats, ${rebuilt.rawOddsCount} odds rows ingested)`
    );
  } catch (e) {
    console.warn('[wc-warm] enriched list rebuild failed:', e);
  }

  try {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    console.log('[wc-warm] Warming combined props snapshot cache...');
    const snapshot = await warmCombinedPropsSnapshot({
      origin: baseUrl,
      cronSecret: cronSecret || undefined,
    });
    console.log(
      `[wc-warm] Combined props snapshot written (wc=${snapshot.worldCup.props.length} props, afl=${snapshot.afl.props.length} props)`
    );
  } catch (e) {
    console.warn('[wc-warm] combined props snapshot warm failed:', e);
  }

  const minCoverage = Number(process.env.WC_PROPS_STATS_MIN_COVERAGE ?? '0');
  if (
    Number.isFinite(minCoverage) &&
    minCoverage > 0 &&
    (result.total ?? 0) > 0 &&
    (result.coveragePct ?? 0) < minCoverage
  ) {
    console.error(
      `[wc-warm] Props-stats coverage below threshold (${result.coveragePct ?? 0}% < ${minCoverage}%)`
    );
    process.exit(1);
  }
}

/** End-to-end: dashboard cache, odds ingest, prod props refresh, props-stats warm. */
async function runFullPipeline(argv: string[]): Promise<void> {
  const warmArgs = argv.filter(
    (a) => !['--full-pipeline', '--skip-local', '--skip-prod'].includes(a)
  );

  let localOddsIngested = false;

  if (!argv.includes('--skip-local')) {
    console.log('\n[wc-pipeline] Phase 1/4 — Dashboard cache (BDL ingest, side panels, DvP, team dashboards)\n');
    await runDashboardWarm(warmArgs);

    const apiFootballKey = (process.env.API_FOOTBALL_KEY || '').trim();
    if (apiFootballKey) {
      console.log('\n[wc-pipeline] Phase 2/4 — Odds ingest (API-Football to Supabase)\n');
      await runRefreshOdds();
      if (!process.exitCode) localOddsIngested = true;
    } else {
      console.warn('[wc-pipeline] Phase 2/4 skipped — API_FOOTBALL_KEY not set');
    }
  } else {
    console.log('[wc-pipeline] Skipping local build phases (--skip-local)');
  }

  const prodUrl = (process.env.PROD_URL || process.env.BASE_URL || '').trim().replace(/\/+$/, '');
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (argv.includes('--skip-prod')) {
    console.log('[wc-pipeline] Skipping production warm (--skip-prod)');
  } else if (!prodUrl || !cronSecret) {
    console.warn('[wc-pipeline] Phases 3–4 skipped — PROD_URL or CRON_SECRET not set');
  } else {
    if (localOddsIngested) {
      console.log(
        '\n[wc-pipeline] Phase 3/4 skipped — odds list already in shared cache from Phase 2 (prod reads same Supabase/Upstash)\n'
      );
    } else {
      console.log('\n[wc-pipeline] Phase 3/4 — Production odds + props list refresh\n');
      await runTriggerWorldCupOddsApi();
      if (process.exitCode) process.exit(process.exitCode);
    }
    console.log('\n[wc-pipeline] Phase 4/4 — Props-stats warm + enriched props page cache\n');
    // Same process as AFL cron: read props list from cache we just wrote, not prod HTTP.
    delete process.env.WC_WARM_USE_LIST;
    await runWarmPropsStats([]);
  }

  console.log('\n[wc-pipeline] All phases complete.\n');
}

async function runDiagnosePropsDvp(argv: string[]): Promise<void> {
  const playerArg = argv.find((a) => a.startsWith('--player='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const statArg = argv.find((a) => a.startsWith('--stat='));
  const { diagnoseWorldCupPropsEnrichment } = await import('../lib/worldCupCache');
  await diagnoseWorldCupPropsEnrichment({
    playerFilter: playerArg ? playerArg.slice('--player='.length) : undefined,
    limit: limitArg ? Number(limitArg.slice('--limit='.length)) : undefined,
    statFilter: statArg ? statArg.slice('--stat='.length) : undefined,
  });
}

function inspectTeamCacheNormalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function inspectTeamCacheSummarize(payload: unknown): string {
  if (payload == null) return '(null)';
  if (Array.isArray(payload)) {
    const sample = payload.slice(0, 2).map((x) => {
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        const name = o.name ?? o.full_name ?? o.player_name ?? o.display_name;
        const id = o.id ?? o.player_id ?? o.bdl_player_id;
        return [name, id].filter(Boolean).join('#') || JSON.stringify(o).slice(0, 80);
      }
      return String(x).slice(0, 80);
    });
    return `array(${payload.length}) sample=[${sample.join(', ')}]`;
  }
  if (typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    const keys = Object.keys(o);
    const parts = [`object keys=${keys.slice(0, 12).join(',')}${keys.length > 12 ? '...' : ''}`];
    for (const prop of ['teams', 'players', 'roster', 'games', 'data'] as const) {
      if (Array.isArray(o[prop])) parts.push(`${prop}=${o[prop].length}`);
    }
    if (o.team && typeof o.team === 'object') {
      const t = o.team as Record<string, unknown>;
      parts.push(`team=${t.name ?? t.full_name ?? t.id}`);
    }
    if (o.player && typeof o.player === 'object') {
      const p = o.player as Record<string, unknown>;
      parts.push(`player=${p.name ?? p.full_name ?? p.id}`);
    }
    return parts.join(' ');
  }
  const s = String(payload);
  return s.length > 120 ? `${s.slice(0, 120)}...` : s;
}

type InspectMatchRow = {
  id?: number;
  datetime?: string | null;
  status?: string | null;
  stage?: string | null;
  home_team?: { id?: number; name?: string } | null;
  away_team?: { id?: number; name?: string } | null;
  home_score?: number | null;
  away_score?: number | null;
};

function inspectTeamInMatch(match: InspectMatchRow, teamId: number): boolean {
  return match.home_team?.id === teamId || match.away_team?.id === teamId;
}

function inspectStageLabel(stage: unknown): string {
  if (stage == null || stage === '') return '';
  if (typeof stage === 'string') return stage;
  if (typeof stage === 'object') {
    const o = stage as Record<string, unknown>;
    return String(o.name ?? o.slug ?? o.short_name ?? o.type ?? '').trim();
  }
  return String(stage);
}

function inspectTeamGoals(
  row: Record<string, unknown>,
  match: InspectMatchRow,
  teamId: number
): number | null {
  const direct = inspectNum(row.goals);
  if (direct != null) return direct;
  if (match.home_team?.id === teamId) return inspectNum(match.home_score);
  if (match.away_team?.id === teamId) return inspectNum(match.away_score);
  return null;
}

async function runInspectTeamGames(
  teamId: number,
  teamName: string,
  getWorldCupCache: <T = unknown>(cacheKey: string) => Promise<T | null>,
  WC2026_CACHE_KEYS: typeof import('../lib/worldCupOpponentBreakdown').WC2026_CACHE_KEYS
): Promise<void> {
  const [matches2026, matchesAll, players] = await Promise.all([
    getWorldCupCache<InspectMatchRow[]>(WC2026_CACHE_KEYS.matches2026),
    getWorldCupCache<InspectMatchRow[]>(WC2026_CACHE_KEYS.matchesAllSeasons),
    getWorldCupCache<Array<{ id?: number; name?: string }>>(WC2026_CACHE_KEYS.playersForTeam(teamId)),
  ]);

  const playerNames = new Map<number, string>();
  for (const p of players ?? []) {
    if (Number.isFinite(p.id)) playerNames.set(Number(p.id), String(p.name ?? p.id));
  }

  const byId = new Map<number, InspectMatchRow>();
  for (const m of [...(matchesAll ?? []), ...(matches2026 ?? [])]) {
    if (Number.isFinite(m.id)) byId.set(Number(m.id), m);
  }

  const teamMatches = [...byId.values()]
    .filter((m) => inspectTeamInMatch(m, teamId))
    .sort((a, b) => String(b.datetime ?? '').localeCompare(String(a.datetime ?? '')));

  console.log(`\n=== Games for ${teamName} (${teamMatches.length} fixtures in cache) ===\n`);
  if (!teamMatches.length) {
    console.log('No fixtures found in wc:raw:matches:2026:v1 or wc:raw:matches:allseasons:v1.');
    return;
  }

  for (const m of teamMatches.slice(0, 12)) {
    const home = m.home_team?.name ?? '?';
    const away = m.away_team?.name ?? '?';
    const isHome = m.home_team?.id === teamId;
    const opponent = isHome ? away : home;
    const venue = isHome ? 'H' : 'A';
    const score =
      m.status === 'completed'
        ? `${m.home_score ?? '?'}-${m.away_score ?? '?'}`
        : String(m.status ?? 'scheduled');
    const detail = await getWorldCupCache<{
      playerStats?: Array<Record<string, unknown>>;
      teamStats?: Array<Record<string, unknown>>;
    }>(WC2026_CACHE_KEYS.matchDetail(m.id!));
    const playerCount = detail?.playerStats?.length ?? 0;
    const teamCount = detail?.teamStats?.length ?? 0;
    const detailLabel = detail
      ? `detail cached (${playerCount} player rows, ${teamCount} team rows)`
      : 'detail MISSING';
    console.log(
      `${String(m.datetime ?? '').slice(0, 16)} | id ${m.id} | ${venue} vs ${opponent} | ${score} | ${inspectStageLabel(m.stage)} | ${detailLabel}`
    );
  }

  const lastCompleted = teamMatches.find((m) => m.status === 'completed');
  if (!lastCompleted?.id) {
    console.log('\nNo completed games cached yet for this team.');
    return;
  }

  const lastId = lastCompleted.id;
  const home = lastCompleted.home_team?.name ?? '?';
  const away = lastCompleted.away_team?.name ?? '?';
  console.log(`\n=== Last completed game: match ${lastId} ===`);
  console.log(
    `${String(lastCompleted.datetime ?? '').slice(0, 16)} | ${home} ${lastCompleted.home_score ?? '?'}-${lastCompleted.away_score ?? '?'} ${away}`
  );
  console.log(`Cache key: ${WC2026_CACHE_KEYS.matchDetail(lastId)}`);

  const detail = await getWorldCupCache<{
    playerStats?: Array<Record<string, unknown>>;
    teamStats?: Array<Record<string, unknown>>;
    shots?: Array<Record<string, unknown>>;
  }>(WC2026_CACHE_KEYS.matchDetail(lastId));

  if (!detail) {
    console.log('Match detail blob not cached — run bdl-cache step 4 to warm wc:match:{id}:v1.');
    return;
  }

  console.log('\nTeam stats:');
  for (const row of detail.teamStats ?? []) {
    const rowTeamId = inspectNum(row.team_id);
    const label =
      rowTeamId === lastCompleted.home_team?.id
        ? home
        : rowTeamId === lastCompleted.away_team?.id
          ? away
          : String(rowTeamId ?? '?');
    const bits = [
      `goals=${inspectTeamGoals(row, lastCompleted, rowTeamId ?? -1) ?? '?'}`,
      `shots=${inspectNum(row.shots_total) ?? '?'}`,
      `sot=${inspectNum(row.shots_on_target) ?? '?'}`,
      `poss=${inspectNum(row.possession_pct) ?? inspectNum(row.possession) ?? '?'}`,
      `passes=${inspectNum(row.passes_total) ?? '?'}`,
      `fouls=${inspectNum(row.fouls) ?? '?'}`,
    ];
    console.log(`  ${label}: ${bits.join(', ')}`);
  }

  const nlPlayerStats = (detail.playerStats ?? []).filter(
    (row) => inspectNum(row.team_id) === teamId
  );
  if (!nlPlayerStats.length) {
    const rosterIds = new Set(
      (players ?? []).map((p) => Number(p.id)).filter((id) => Number.isFinite(id))
    );
    const fromPlayerCache: Array<Record<string, unknown>> = [];
    for (const pid of rosterIds) {
      const rows =
        (await getWorldCupCache<Array<Record<string, unknown>>>(
          WC2026_CACHE_KEYS.playerStats(pid)
        )) ?? [];
      for (const row of rows) {
        if (inspectNum(row.match_id) === lastId) fromPlayerCache.push(row);
      }
    }
    if (fromPlayerCache.length) {
      console.log(
        `\n${teamName} player stats (0 in match blob; ${fromPlayerCache.length} in wc:player:stats:* for this match):`
      );
      const sortedFallback = [...fromPlayerCache].sort(
        (a, b) => (inspectNum(b.goals) ?? 0) - (inspectNum(a.goals) ?? 0) ||
          (inspectNum(b.shots_total) ?? 0) - (inspectNum(a.shots_total) ?? 0)
      );
      for (const row of sortedFallback.slice(0, 15)) {
        const pid = inspectNum(row.player_id);
        const name =
          (pid != null ? playerNames.get(pid) : null) ?? String(row.player_name ?? pid ?? '?');
        console.log(
          `  ${name}: goals=${inspectNum(row.goals) ?? 0}, ast=${inspectNum(row.assists) ?? 0}, shots=${inspectNum(row.shots_total) ?? 0}, sot=${inspectNum(row.shots_on_target) ?? 0}, mins=${inspectNum(row.minutes_played) ?? inspectNum(row.minutes) ?? '?'}`
        );
      }
      if (sortedFallback.length > 15) {
        console.log(`  ... and ${sortedFallback.length - 15} more`);
      }
      return;
    }
    console.log(
      `\n${teamName} player stats: none in wc:match:${lastId}:v1 and none in wc:player:stats:* for this match.`
    );
    console.log(
      'Refresh with: npx tsx scripts/build-world-cup-opponent-breakdown.ts --bdl-cache --incremental --step=4 --force'
    );
    return;
  }

  console.log(`\n${teamName} player stats (${nlPlayerStats.length} rows):`);
  const sortedPlayers = [...nlPlayerStats].sort(
    (a, b) => (inspectNum(b.goals) ?? 0) - (inspectNum(a.goals) ?? 0) ||
      (inspectNum(b.shots_total) ?? 0) - (inspectNum(a.shots_total) ?? 0)
  );
  for (const row of sortedPlayers.slice(0, 15)) {
    const pid = inspectNum(row.player_id);
    const name = (pid != null ? playerNames.get(pid) : null) ?? String(row.player_name ?? pid ?? '?');
    console.log(
      `  ${name}: goals=${inspectNum(row.goals) ?? 0}, ast=${inspectNum(row.assists) ?? 0}, shots=${inspectNum(row.shots_total) ?? 0}, sot=${inspectNum(row.shots_on_target) ?? 0}, mins=${inspectNum(row.minutes_played) ?? inspectNum(row.minutes) ?? '?'}`
    );
  }
  if (sortedPlayers.length > 15) {
    console.log(`  ... and ${sortedPlayers.length - 15} more`);
  }
}

async function runInspectTeamCache(argv: string[]): Promise<void> {
  const showAllKeys = argv.includes('--all-keys');
  const teamIdArg = argv.find((a) => a.startsWith('--team-id='))?.split('=')[1];
  const teamQuery =
    argv.find((a) => a.startsWith('--inspect-team='))?.slice('--inspect-team='.length) ??
    (() => {
      const idx = argv.indexOf('--inspect-team');
      if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
      return argv.find((a) => !a.startsWith('--')) ?? 'netherlands';
    })();

  const { supabaseAdmin } = await import('../lib/supabaseAdmin');
  const { getWorldCupCache } = await import('../lib/worldCupCache');
  const { WC2026_CACHE_KEYS } = await import('../lib/worldCupOpponentBreakdown');

  let teamId = teamIdArg ? Number(teamIdArg) : NaN;
  let teamName = teamIdArg ? `teamId=${teamIdArg}` : teamQuery;

  if (!Number.isFinite(teamId)) {
    const teams =
      (await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.teams)) ?? [];
    const q = inspectTeamCacheNormalize(teamQuery);
    const aliases = new Set([q, 'holland', 'netherlands', 'nld', 'ned']);
    const match = teams.find((t) => {
      const name = inspectTeamCacheNormalize(String(t.name ?? t.full_name ?? ''));
      const abbr = inspectTeamCacheNormalize(String(t.abbreviation ?? t.code ?? ''));
      return aliases.has(name) || aliases.has(abbr) || name.includes(q) || q.includes(name);
    });
    if (!match) {
      console.log(`No team match for "${teamQuery}" in ${WC2026_CACHE_KEYS.teams} (${teams.length} teams cached).`);
      console.log(
        'Sample teams:',
        teams.slice(0, 8).map((t) => `${t.id}:${t.name}`).join(', ')
      );
      return;
    }
    teamId = Number(match.id);
    teamName = String(match.name ?? match.full_name ?? teamQuery);
    console.log(`Resolved ${teamName} -> BDL team id ${teamId}\n`);
  }

  await runInspectTeamGames(teamId, teamName, getWorldCupCache, WC2026_CACHE_KEYS);

  if (!showAllKeys) return;

  const patterns = [
    `%${teamId}%`,
    `%${inspectTeamCacheNormalize(teamName).replace(/ /g, '%')}%`,
    '%netherlands%',
    '%holland%',
  ];

  const seen = new Map<string, { updated_at?: string; summary: string; bytes: number }>();

  for (const pattern of patterns) {
    const { data, error } = await supabaseAdmin
      .from('world_cup_cache')
      .select('cache_key, payload, updated_at')
      .ilike('cache_key', pattern)
      .order('cache_key');
    if (error) throw error;
    for (const row of data ?? []) {
      const bytes = Buffer.byteLength(JSON.stringify(row.payload ?? null), 'utf8');
      seen.set(row.cache_key, {
        updated_at: row.updated_at,
        summary: inspectTeamCacheSummarize(row.payload),
        bytes,
      });
    }
  }

  const expectedKeys = [
    WC2026_CACHE_KEYS.rosterForTeam(teamId),
    WC2026_CACHE_KEYS.playersForTeam(teamId),
    `wc:lineup-squad-photos:${teamId}:v1`,
    `wc:dashboard:v23:WC:2026:${teamId}:none:none`,
    `wc:dashboard:v23:world-cup:2026:${teamId}:none:none`,
  ];

  for (const k of expectedKeys) {
    if (seen.has(k)) continue;
    const { data, error } = await supabaseAdmin
      .from('world_cup_cache')
      .select('cache_key, payload, updated_at')
      .eq('cache_key', k)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const bytes = Buffer.byteLength(JSON.stringify(data.payload ?? null), 'utf8');
      seen.set(data.cache_key, {
        updated_at: data.updated_at,
        summary: inspectTeamCacheSummarize(data.payload),
        bytes,
      });
    }
  }

  const rows = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`Found ${rows.length} cache entries for ${teamName} (id ${teamId}):\n`);

  let totalBytes = 0;
  for (const [cacheKey, meta] of rows) {
    totalBytes += meta.bytes;
    console.log(`${cacheKey}`);
    console.log(`  updated: ${meta.updated_at ?? 'n/a'}  size: ${(meta.bytes / 1024).toFixed(1)} KB`);
    console.log(`  ${meta.summary}\n`);
  }
  console.log(`Total payload size: ${(totalBytes / 1024).toFixed(1)} KB`);

  const missing = [
    WC2026_CACHE_KEYS.rosterForTeam(teamId),
    WC2026_CACHE_KEYS.playersForTeam(teamId),
    `wc:lineup-squad-photos:${teamId}:v1`,
  ].filter((k) => !seen.has(k));
  if (missing.length) {
    console.log('\nMissing expected keys:');
    for (const k of missing) console.log(`  - ${k}`);
  }
}

function debugOppArg(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith('--')) return argv[idx + 1];
  return undefined;
}

async function runDebugWc2026OppBreakdown(argv: string[]): Promise<void> {
  const { debugWc2026OpponentBreakdown } = await import('../lib/worldCupOpponentBreakdown');

  const teamFilter = debugOppArg(argv, 'team');
  const matchRaw = debugOppArg(argv, 'match');
  const matchId = matchRaw ? Number.parseInt(matchRaw, 10) : undefined;
  const verbose = argv.includes('--verbose');
  const outPath = debugOppArg(argv, 'out');

  console.log('[wc-opp-debug] Tracing WC 2026 opponent breakdown pipeline...\n');

  const report = await debugWc2026OpponentBreakdown({
    teamFilter,
    matchId: Number.isFinite(matchId) ? matchId : undefined,
  });

  const fmtSide = (side: import('../lib/worldCupOpponentBreakdown').Wc2026OppBreakdownDebugSide | null): string => {
    if (!side) return '  (no side data)';
    const status = side.qualified ? 'QUALIFIED' : `REJECTED - ${side.rejectReason ?? 'unknown'}`;
    const vol = Object.entries(side.volumeTotals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return [
      `  ${side.defendingName} (${side.defendingSlug}) allowed vs ${side.opponentName}: ${status}`,
      `    opponent team stat row: ${side.opponentPlayerRows ? 'yes' : 'no'}, rich (Game Props gate): ${side.eligibleOpponentRows ? 'yes' : 'no'}`,
      `    volume: ${vol || '(none)'}`,
      `    corners (team sheet): ${side.cornersFromTeamSheet ?? '-'}`,
      side.qualified
        ? `    totals: goals=${side.allTotals.goals}, shots=${side.allTotals.shots_total}, sot=${side.allTotals.shots_on_target}, passes=${side.allTotals.passes_accurate}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const printMatch = (m: import('../lib/worldCupOpponentBreakdown').Wc2026OppBreakdownDebugMatch): void => {
    const score =
      m.homeScore != null && m.awayScore != null ? `${m.homeScore}-${m.awayScore}` : '?-?';
    console.log(
      `\n-- Match #${m.matchId} | ${m.datetime} | ${m.stage}\n   ${m.homeName} vs ${m.awayName} (${score})`
    );
    if (!m.hasDetail) {
      console.log('   NO team_match_stats for both teams - both sides skipped');
      return;
    }
    console.log(`   player stat rows: ${m.playerStatRows}`);
    console.log(fmtSide(m.homeSide));
    console.log(fmtSide(m.awaySide));
  };

  const printHistogram = (label: string, hist: Record<string, number>): void => {
    const entries = Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (!entries.length) {
      console.log(`  ${label}: (empty)`);
      return;
    }
    console.log(`  ${label}:`);
    for (const [games, count] of entries) {
      console.log(`    ${games} game(s): ${count} team(s)`);
    }
  };

  console.log('=== FIXTURES (wc:raw:matches:2026:v1) ===');
  console.log(`  Total fixtures in cache:     ${report.fixtures.totalFixtures}`);
  console.log(`  Completed:                   ${report.fixtures.completedFixtures}`);
  console.log(`  With team_match_stats rows:  ${report.fixtures.withMatchDetail}`);
  console.log(`  Missing team_match_stats:    ${report.fixtures.withoutMatchDetail}`);
  console.log('  Stage breakdown (completed):');
  for (const [stage, count] of Object.entries(report.fixtures.stageCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count}x  ${stage}`);
  }

  console.log('\n=== BUILD FUNNEL (recomputed from cache) ===');
  console.log(`  Defensive sides evaluated:   ${report.buildFunnel.sidesEvaluated}`);
  console.log(`  Sides qualified (counted):   ${report.buildFunnel.sidesQualified}`);
  console.log(`  Rejected (no volume stats):  ${report.buildFunnel.sidesRejectedNoVolume}`);
  console.log(`  Rejected (corners only):     ${report.buildFunnel.sidesRejectedCornersOnly}`);
  console.log(`  Skipped (no match detail):   ${report.buildFunnel.sidesSkippedNoDetail}`);
  console.log(`  Teams with >=1 game:         ${report.buildFunnel.teamsWithGames}`);

  console.log('\n=== CACHED PAYLOAD (wc:opp-breakdown:wc2026:v3) ===');
  console.log(`  Present:                     ${report.cachedPayload.present}`);
  console.log(`  Generated at:                ${report.cachedPayload.generatedAt ?? '-'}`);
  console.log(`  Teams in cache:              ${report.cachedPayload.teamCount}`);
  console.log(`  Teams with games > 0:        ${report.cachedPayload.teamsWithGames}`);
  printHistogram('Cached game-count histogram', report.cachedPayload.gameCountHistogram);

  console.log('\n=== RECOMPUTED (same logic as step 7 build) ===');
  console.log(`  Teams:                       ${report.recomputed.teamCount}`);
  console.log(`  Allowing 1+ goals/game:      ${report.recomputed.nonZeroGoalsTeams}`);
  console.log(`  Allowing 1+ SOT/game:        ${report.recomputed.nonZeroSotTeams}`);
  printHistogram('Recomputed game-count histogram', report.recomputed.gameCountHistogram);

  if (report.cachedPayload.teamCount !== report.recomputed.teamCount) {
    console.log(
      `\n  MISMATCH: cached has ${report.cachedPayload.teamCount} teams, recompute has ${report.recomputed.teamCount}`
    );
    console.log('    Re-run: npm run build:world-cup:bdl-cache -- --step=7 --force --incremental');
  }

  if (report.recomputed.teamsWithGames >= 40 && report.fixtures.completedFixtures < 20) {
    console.log(
      `\n  WARNING: ${report.recomputed.teamsWithGames} teams have games but only ${report.fixtures.completedFixtures} fixtures — check stage breakdown.`
    );
  } else if (report.recomputed.teamsWithGames === 48) {
    console.log(
      `\n  Note: all 48 teams have >=1 group-stage game (${report.fixtures.completedFixtures} fixtures, ${report.buildFunnel.sidesQualified} defensive samples).`
    );
  }

  console.log('\n=== TEAMS (sorted by games desc) ===');
  const teamLimit = verbose ? report.teams.length : Math.min(report.teams.length, 20);
  for (const team of report.teams.slice(0, teamLimit)) {
    console.log(
      `\n${team.name} (${team.slug}) - ${team.games} game(s) | goals=${team.averages.goals} sot=${team.averages.shots_on_target} shots=${team.averages.shots_total} passes=${team.averages.passes_accurate}`
    );
    for (const pm of team.perMatch) {
      console.log(
        `  #${pm.matchId} ${pm.datetime} vs ${pm.opponent} [${pm.stage}] - qualified by: ${pm.qualifyingStats.join(', ') || '?'}`
      );
      if (verbose) {
        console.log(
          `      allowed: g=${pm.totals.goals} sot=${pm.totals.shots_on_target} shots=${pm.totals.shots_total} pass=${pm.totals.passes_accurate} corners=${pm.totals.corners ?? 0}`
        );
      }
    }
  }
  if (!verbose && report.teams.length > teamLimit) {
    console.log(`\n  ... ${report.teams.length - teamLimit} more teams (use --verbose to show all)`);
  }

  if (teamFilter || matchId != null) {
    console.log('\n=== MATCH DETAIL ===');
    if (!report.matches.length) {
      console.log('  No matches matched the filter.');
    } else {
      for (const m of report.matches) printMatch(m);
    }
  } else if (verbose) {
    console.log('\n=== ALL MATCHES ===');
    for (const m of report.matches) printMatch(m);
  } else {
    console.log('\n=== SAMPLE MATCHES (first 5) ===');
    console.log('  Tip: --team norway or --match 12345 or --verbose for full match trace');
    for (const m of report.matches.slice(0, 5)) printMatch(m);
  }

  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    fs.writeFileSync(resolved, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n[wc-opp-debug] Full JSON written to ${resolved}`);
  }

  console.log('\n[wc-opp-debug] Done.');
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--inspect-team') || argv.some((a) => a.startsWith('--inspect-team='))) {
    await runInspectTeamCache(argv.filter((a) => a !== '--inspect-team'));
    return;
  }

  if (argv.includes('--debug-opp-breakdown')) {
    await runDebugWc2026OppBreakdown(argv.filter((a) => a !== '--debug-opp-breakdown'));
    return;
  }

  if (argv.includes('--diagnose-props-dvp')) {
    const args = argv.filter((a) => a !== '--diagnose-props-dvp');
    await runDiagnosePropsDvp(args);
    return;
  }

  if (argv.includes('--trigger-odds-api')) {
    await runTriggerWorldCupOddsApi();
    return;
  }

  if (argv.includes('--refresh-odds')) {
    await runRefreshOdds();
    return;
  }

  if (argv.includes('--rebuild-enriched-only')) {
    await runRebuildEnrichedOnly();
    return;
  }

  if (argv.includes('--warm-props-stats')) {
    await runWarmPropsStats(argv.filter((a) => a !== '--warm-props-stats'));
    return;
  }

  if (argv.includes('--full-pipeline')) {
    const pipeArgs = argv.filter((a) => a !== '--full-pipeline');
    await runFullPipeline(pipeArgs);
    return;
  }

  if (argv.includes('--dashboard-warm')) {
    const warmArgs = argv.filter((a) => a !== '--dashboard-warm');
    await runDashboardWarm(warmArgs);
    return;
  }

  if (argv.includes('--bdl-cache')) {
    const { runBuildWorldCup2026Cache } = await import('../lib/worldCupOpponentBreakdown');
    const args = process.argv.slice(2).filter((a) => a !== '--bdl-cache');
    await runBuildWorldCup2026Cache(args);
    return;
  }

  if (process.argv.includes('--dvp-diagnose')) {
    const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
    const { diagnoseWorldCupDvpCoverage } = await import('../lib/internationalDashboard');
    const { loadWorldCupQualifiedTeamMap } = await import('../lib/worldCupOpponentBreakdown');
    const qualified = await loadWorldCupQualifiedTeamMap(apiKey);
    await diagnoseWorldCupDvpCoverage(qualified, (m) => console.log(`[dvp-diag] ${m}`));
    return;
  }

  if (process.argv.includes('--dvp-only')) {
    const dvpApiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
    const { refreshWorldCupDvpCache, WC_DVP_POSITIONS, WC_DVP_WINDOWS } = await import(
      '../lib/internationalDashboard'
    );
    const { loadWorldCupQualifiedSlugs } = await import('../lib/worldCupOpponentBreakdown');
    const label = (w: number) => (w === 0 ? 'All' : `L${w}`);
    console.log(
      `[dvp] computing ${WC_DVP_POSITIONS.length} positions x ${WC_DVP_WINDOWS.length} windows ` +
        `(${WC_DVP_POSITIONS.join('/')} x ${WC_DVP_WINDOWS.map(label).join('/')})`
    );
    console.log('[dvp] prefer running with the dev server stopped to avoid DB contention.');
    const qualifiedSlugs = await loadWorldCupQualifiedSlugs(dvpApiKey);
    console.log(`[dvp] qualified World Cup nations: ${qualifiedSlugs.size}`);
    const started = Date.now();
    const { entries, teams } = await refreshWorldCupDvpCache(
      (msg) => console.log(`[dvp] ${msg}`),
      qualifiedSlugs
    );
    console.log(
      `[dvp] done - ${entries} entries (up to ${teams} nations) in ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`
    );
    return;
  }

  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[opp-breakdown] BALLDONTLIE_API_KEY missing — World Cup games AND the 48-team universe will be skipped. Rankings will fall back to every nation seen in the international sources. Set the key to rank the 48 qualified teams.');
  }

  const { refreshOpponentBreakdownCache, OPP_BREAKDOWN_WINDOWS, OPP_BREAKDOWN_ALL_WINDOW } =
    await import('../lib/worldCupOpponentBreakdown');

  const label = (w: number) => (w === OPP_BREAKDOWN_ALL_WINDOW ? 'All' : `L${w}`);
  console.log(`[opp-breakdown] computing windows: ${OPP_BREAKDOWN_WINDOWS.map(label).join(', ')}`);
  console.log('[opp-breakdown] prefer running with the dev server stopped to avoid BDL rate limits / DB contention.');
  const started = Date.now();
  // Each of the 48 qualified nations (BDL season 2026) is assembled through the
  // SAME pipeline the Game Props chart uses — BDL World Cup history +
  // loadInternationalTeamStatsByCountry, normalized/deduped/rich-filtered — so the
  // breakdown's "allowed" averages always match the chart. Processed one nation
  // at a time, so memory stays flat.
  const all = await refreshOpponentBreakdownCache(apiKey);

  for (const window of OPP_BREAKDOWN_WINDOWS) {
    const payload = all[window];
    const teamCount = Object.keys(payload.names).length;
    console.log(`[opp-breakdown] ${label(window)}: cached ${teamCount} nations`);
  }
  console.log(`[opp-breakdown] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[opp-breakdown] failed:', err);
    process.exit(1);
  });
