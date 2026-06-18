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
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --full-pipeline
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --diagnose-props-dvp
 *   npx tsx scripts/build-world-cup-opponent-breakdown.ts --diagnose-props-dvp --player="Lamine Yamal"
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

async function runWarmPropsStats(): Promise<void> {
  const {
    runWorldCupPropsStatsWarm,
    rebuildWorldCupEnrichedListFromOddsCache,
  } = await import('../lib/worldCupCache');
  const { warmCombinedPropsSnapshot } = await import('../lib/combinedPropsSnapshot');

  const baseUrl = (process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
  const useListApi = process.env.WC_WARM_USE_LIST === '1';
  console.log(`[wc-warm] Warming props stats (useListApi=${useListApi})...`);
  const result = await runWorldCupPropsStatsWarm(baseUrl, { useListApi });
  console.log('[wc-warm]', JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
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

  try {
    console.log('[wc-warm] Rebuilding enriched props cache from odds + warmed stats...');
    const rebuilt = await rebuildWorldCupEnrichedListFromOddsCache({
      cacheOnly: true,
      skipRowMeta: true,
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
    await runWarmPropsStats();
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

async function main() {
  const argv = process.argv.slice(2);

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

  if (argv.includes('--warm-props-stats')) {
    await runWarmPropsStats();
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
