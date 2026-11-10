import type { NextConfig } from "next";

const chromiumBinTrace = ['./node_modules/@sparticuz/chromium/bin/**/*'] as const;

const AFL_DISPOSALS_HISTORY_TRACE_FILES = [
  './data/afl-model/history/**/*',
  './data/afl-model/latest-disposals-projections.json',
] as const;

const TENNIS_RUNTIME_DATA = [
  './data/tennis/rank-history.json',
  './data/tennis/espn-hands.json',
  './data/tennis/headshots.json',
  // Full names by player id — Redis/odds often keep "A. Michelsen".
  './data/tennis/player-names.json',
] as const;

/** Shared junk that no API route should pack (scripts / local scrapes only). */
const DATA_JUNK_EXCLUDES = [
  './data/soccer*/**/*',
  './data/soccerway-*.json',
  './data/rotogrinders-*.html',
  './data/sportsline-*.json',
  './data/player_positions/**/*',
  './data/tennis/api-tennis/**/*',
  './data/tennis/rank-raw/**/*',
  './data/tennis/surface-raw/**/*',
] as const;

/** Fat NBL cache dirs most routes never read (engine picks / history / charts). */
const NBL_HEAVY_UNUSED_EXCLUDES = [
  './data/nbl-model/cache/engine-picks/**/*',
  './data/nbl-model/cache/player-prop-history/**/*',
  './data/nbl-model/cache/game-odds-history/**/*',
  './data/nbl-model/cache/shot-charts/**/*',
  './data/nbl-model/cache/shot-chart-players/**/*',
  './data/nbl-model/cache/shot-chart-defense/**/*',
  './data/nbl-model/cache/shot-chart-manifest-*.json',
  './data/nbl-model/cache/assist-shots/**/*',
  './data/nbl-model/cache/assist-chart-players/**/*',
  './data/nbl-model/cache/assist-defense/**/*',
  './data/nbl-model/cache/period-scores/**/*',
  './data/nbl-model/cache/pbp/**/*',
  './data/nbl-model/cache/pbp-chem/**/*',
  './data/nbl-model/cache/lineups/**/*',
] as const;

/** build-afl-dvp.js is spawned via process.cwd(), so tracing pulls in the whole repo unless trimmed. */
const AFL_ODDS_REFRESH_TRACE = [
  './scripts/build-afl-dvp.js',
  './data/afl-league-player-stats-*.json',
  './data/afl-team-rankings-*.json',
  './data/afl-dfs-role-map-latest.json',
] as const;

/**
 * AFL-only props routes read JSON via process.cwd(); without excludes NFT packs NBL/tennis (~214MB+)
 * and blows the 250MB limit.
 */
const AFL_PROPS_CWD_TRACE = [
  './data/afl-league-player-stats-*.json',
  './data/afl-dvp-*.json',
  './data/afl-dvp-depth-*.json',
  './data/afl-team-rankings-*-oa.json',
  './data/afl-dfs-role-map-latest.json',
  './data/afl-model/latest-disposals-projections.json',
  './data/afl-model/history/**/*',
] as const;
const AFL_PROPS_CWD_EXCLUDES = [
  './data/nbl-model/**/*',
  './data/nbl-*.json',
  './data/tennis/**/*',
  ...DATA_JUNK_EXCLUDES,
] as const;

/**
 * Combined props / AFL odds refresh: need AFL + tennis runtime + NBL prop lines/logs,
 * but not the full NBL cache (engine-picks alone is ~102MB).
 */
const COMBINED_PROPS_CWD_TRACE = [
  ...AFL_PROPS_CWD_TRACE,
  ...AFL_ODDS_REFRESH_TRACE,
  ...TENNIS_RUNTIME_DATA,
  './data/tennis/tournament-surfaces.json',
  './data/nbl-roster-*.json',
  './data/nbl-league-player-stats-*.json',
  './data/nbl-model/cache/player-prop-lines/**/*',
  './data/nbl-model/cache/player-props-list.json',
  './data/nbl-model/cache/player-logs/**/*',
] as const;
const COMBINED_PROPS_CWD_EXCLUDES = [
  ...NBL_HEAVY_UNUSED_EXCLUDES,
  ...DATA_JUNK_EXCLUDES,
] as const;

/**
 * AI picks cron scans NBL + tennis (must keep those), but cwd tracing packs the full NBL cache.
 * Keep logs/pbp/shot-charts/lineups; drop engine-picks + prop-line archives.
 */
const AI_PICKS_RUN_TRACE = [
  './data/nbl-roster-*.json',
  './data/nbl-injuries.json',
  './data/nbl-schedule-*.json',
  './data/nbl-league-player-stats-*.json',
  './data/nbl-next-matches*.json',
  './data/nbl-model/cache/player-logs/**/*',
  './data/nbl-model/cache/pbp/**/*',
  './data/nbl-model/cache/pbp-chem/**/*',
  './data/nbl-model/cache/shot-charts/**/*',
  './data/nbl-model/cache/shot-chart-players/**/*',
  './data/nbl-model/cache/shot-chart-defense/**/*',
  './data/nbl-model/cache/shot-chart-manifest-*.json',
  './data/nbl-model/cache/lineups/**/*',
  ...TENNIS_RUNTIME_DATA,
  './data/tennis/tournament-surfaces.json',
] as const;
const AI_PICKS_RUN_EXCLUDES = [
  './data/nbl-model/cache/engine-picks/**/*',
  './data/nbl-model/cache/player-prop-lines/**/*',
  './data/nbl-model/cache/player-prop-history/**/*',
  './data/nbl-model/cache/game-odds-history/**/*',
  './data/nbl-model/cache/assist-shots/**/*',
  './data/nbl-model/cache/assist-chart-players/**/*',
  './data/nbl-model/cache/assist-defense/**/*',
  './data/nbl-model/cache/period-scores/**/*',
  './data/nbl-model/cache/player-props-list.json',
  ...DATA_JUNK_EXCLUDES,
] as const;

/**
 * Grade imports playerPropSnapshots → oddsHistory, which joins process.cwd()/data/nbl-model/cache.
 * NFT then packs the whole cache (engine-picks alone ~116MB) and blows the 250MB limit.
 * Keep closing prop-line snapshots; drop the heavy unused siblings.
 */
const AI_PICKS_GRADE_TRACE = [
  './data/nbl-model/cache/player-prop-lines/**/*',
  ...TENNIS_RUNTIME_DATA,
] as const;
const AI_PICKS_GRADE_EXCLUDES = [
  './data/nbl-model/cache/engine-picks/**/*',
  './data/nbl-model/cache/player-prop-history/**/*',
  './data/nbl-model/cache/game-odds-history/**/*',
  './data/nbl-model/cache/shot-charts/**/*',
  './data/nbl-model/cache/shot-chart-players/**/*',
  './data/nbl-model/cache/shot-chart-defense/**/*',
  './data/nbl-model/cache/shot-chart-manifest-*.json',
  './data/nbl-model/cache/assist-shots/**/*',
  './data/nbl-model/cache/assist-chart-players/**/*',
  './data/nbl-model/cache/assist-defense/**/*',
  './data/nbl-model/cache/period-scores/**/*',
  './data/nbl-model/cache/pbp/**/*',
  './data/nbl-model/cache/pbp-chem/**/*',
  './data/nbl-model/cache/lineups/**/*',
  './data/nbl-model/cache/player-logs/**/*',
  './data/nbl-model/cache/player-props-list.json',
  './data/afl-model/**/*',
  './data/nbl-engine/**/*',
  ...DATA_JUNK_EXCLUDES,
] as const;

/** NBL props/odds: need lines + logs; drop engine-picks and chart/pbp archives. */
const NBL_PROPS_CWD_TRACE = [
  './data/nbl-roster-*.json',
  './data/nbl-league-player-stats-*.json',
  './data/nbl-schedule-*.json',
  './data/nbl-model/cache/player-prop-lines/**/*',
  './data/nbl-model/cache/player-props-list.json',
  './data/nbl-model/cache/player-logs/**/*',
] as const;
const NBL_PROPS_CWD_EXCLUDES = [
  './data/nbl-model/cache/engine-picks/**/*',
  './data/nbl-model/cache/player-prop-history/**/*',
  './data/nbl-model/cache/game-odds-history/**/*',
  './data/nbl-model/cache/shot-charts/**/*',
  './data/nbl-model/cache/shot-chart-players/**/*',
  './data/nbl-model/cache/shot-chart-defense/**/*',
  './data/nbl-model/cache/shot-chart-manifest-*.json',
  './data/nbl-model/cache/assist-shots/**/*',
  './data/nbl-model/cache/assist-chart-players/**/*',
  './data/nbl-model/cache/assist-defense/**/*',
  './data/nbl-model/cache/period-scores/**/*',
  './data/nbl-model/cache/pbp/**/*',
  './data/nbl-model/cache/pbp-chem/**/*',
  './data/nbl-model/cache/lineups/**/*',
  './data/tennis/**/*',
  ...DATA_JUNK_EXCLUDES,
] as const;

const NBL_LINE_MOVEMENT_TRACE = [
  ...NBL_PROPS_CWD_TRACE,
  './data/nbl-model/cache/player-prop-history/**/*',
] as const;
const NBL_LINE_MOVEMENT_EXCLUDES = [
  './data/nbl-model/cache/engine-picks/**/*',
  './data/nbl-model/cache/game-odds-history/**/*',
  './data/nbl-model/cache/shot-charts/**/*',
  './data/nbl-model/cache/shot-chart-players/**/*',
  './data/nbl-model/cache/shot-chart-defense/**/*',
  './data/nbl-model/cache/shot-chart-manifest-*.json',
  './data/nbl-model/cache/assist-shots/**/*',
  './data/nbl-model/cache/assist-chart-players/**/*',
  './data/nbl-model/cache/assist-defense/**/*',
  './data/nbl-model/cache/period-scores/**/*',
  './data/nbl-model/cache/pbp/**/*',
  './data/nbl-model/cache/pbp-chem/**/*',
  './data/nbl-model/cache/lineups/**/*',
  './data/tennis/**/*',
  ...DATA_JUNK_EXCLUDES,
] as const;

/** Drop prop-line archives from analytics routes that only need logs/charts. */
const NBL_ANALYTICS_EXCLUDES = [
  './data/nbl-model/cache/engine-picks/**/*',
  './data/nbl-model/cache/player-prop-lines/**/*',
  './data/nbl-model/cache/player-prop-history/**/*',
  './data/nbl-model/cache/game-odds-history/**/*',
  './data/nbl-model/cache/player-props-list.json',
  './data/tennis/**/*',
  ...DATA_JUNK_EXCLUDES,
] as const;

const NBL_ENGINE_TRACE = [
  './data/nbl-roster-*.json',
  './data/nbl-model/cache/engine-picks/**/*',
  './data/nbl-model/cache/player-logs/**/*',
] as const;
const NBL_ENGINE_EXCLUDES = [
  './data/nbl-model/cache/player-prop-lines/**/*',
  './data/nbl-model/cache/player-prop-history/**/*',
  './data/nbl-model/cache/game-odds-history/**/*',
  './data/nbl-model/cache/player-props-list.json',
  './data/nbl-model/cache/shot-charts/**/*',
  './data/nbl-model/cache/shot-chart-players/**/*',
  './data/nbl-model/cache/shot-chart-defense/**/*',
  './data/nbl-model/cache/assist-shots/**/*',
  './data/nbl-model/cache/assist-chart-players/**/*',
  './data/nbl-model/cache/assist-defense/**/*',
  './data/nbl-model/cache/period-scores/**/*',
  './data/tennis/**/*',
  ...DATA_JUNK_EXCLUDES,
] as const;

const NBL_SCHEDULE_TRACE = ['./data/nbl-schedule-*.json', './data/nbl-roster-*.json'] as const;
const NBL_LINEUP_TRACE = [
  ...NBL_SCHEDULE_TRACE,
  './data/nbl-model/cache/lineups/**/*',
] as const;
const NBL_PLAYER_LOG_TRACE = [
  ...NBL_SCHEDULE_TRACE,
  './data/nbl-league-player-stats-*.json',
  './data/nbl-player-game-logs-index-*.json',
  './data/nbl-model/cache/player-logs/**/*',
  './data/nbl-model/cache/pbp/**/*',
  './data/nbl-model/cache/pbp-chem/**/*',
] as const;
const NBL_SHOT_TRACE = [
  ...NBL_PLAYER_LOG_TRACE,
  './data/nbl-model/cache/shot-charts/**/*',
  './data/nbl-model/cache/shot-chart-players/**/*',
  './data/nbl-model/cache/shot-chart-defense/**/*',
  './data/nbl-model/cache/shot-chart-manifest-*.json',
  './data/nbl-model/cache/assist-shots/**/*',
  './data/nbl-model/cache/assist-chart-players/**/*',
  './data/nbl-model/cache/assist-defense/**/*',
] as const;
const NBL_PERIOD_TRACE = [
  ...NBL_SCHEDULE_TRACE,
  './data/nbl-model/cache/period-scores/**/*',
] as const;
const NBL_STATS_TRACE = [
  ...NBL_SCHEDULE_TRACE,
  './data/nbl-ladder-*.json',
  './data/nbl-team-stats-*.json',
  './data/nbl-league-player-stats-*.json',
  './data/nbl-next-matches*.json',
  './data/nbl-player-game-logs-index-*.json',
] as const;

/** Register both `/api/foo` and `/api/foo/route` keys (Vercel / Next disagree on which NFT uses). */
function routeTrace(
  paths: readonly string[],
  files: readonly string[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of paths) {
    out[p] = [...files];
    out[`${p}/route`] = [...files];
  }
  return out;
}

const AFL_PROPS_ROUTES = [
  '/api/afl/player-props/list',
  '/api/afl/props-stats/warm',
  '/api/afl/props-stats/batch',
  '/api/afl/props-stats/clear',
  '/api/afl/player-props',
  '/api/afl/player-props/refresh',
  '/api/afl/players',
  '/api/afl/next-game',
  '/api/afl/dfs-role',
  '/api/afl/dvp',
  '/api/afl/dvp/batch',
  '/api/afl/league-player-stats',
  '/api/afl/footywire-lineup',
  '/api/afl/team-roster',
  '/api/afl/team-rankings',
  '/api/afl/team-game-logs',
  '/api/afl/role-leaders',
  '/api/afl/player-portraits',
  '/api/afl/cron/league-player-stats',
] as const;

const COMBINED_PROPS_ROUTES = [
  '/api/cron/refresh-combined-props',
  '/api/afl/odds/refresh',
  '/api/props/combined',
] as const;

const NBL_PROPS_ROUTES = [
  '/api/nbl/player-props/list',
  '/api/nbl/player-props',
  '/api/nbl/odds',
  '/api/nbl/odds/refresh',
  '/api/cron/refresh-nbl-odds',
] as const;

const NBL_ANALYTICS_ROUTES = [
  '/api/nbl/lineups',
  '/api/nbl/predicted-starters',
  '/api/nbl/player-game-logs',
  '/api/nbl/shot-chart',
  '/api/nbl/team-game-logs',
  '/api/nbl/play-types',
  '/api/nbl/player-ratings',
  '/api/nbl/chemistry',
  '/api/nbl/team-usage',
  '/api/nbl/team-ste-stats',
  '/api/nbl/team-ratings',
  '/api/nbl/similar-players',
  '/api/nbl/ladder',
  '/api/nbl/schedule',
  '/api/nbl/league-player-stats',
  '/api/nbl/next-game',
  '/api/nbl/players',
] as const;

const nextConfig: NextConfig = {
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // Vercel file tracing omits @sparticuz/chromium/bin/*.br unless explicitly included
  outputFileTracingIncludes: {
    '/api/soccer/player-stats-batch': [...chromiumBinTrace],
    '/api/soccer/player-props-test': [...chromiumBinTrace],
    '/api/afl/model/disposals/top-picks': [...AFL_DISPOSALS_HISTORY_TRACE_FILES],
    '/api/afl/model/disposals/top-picks/route': [...AFL_DISPOSALS_HISTORY_TRACE_FILES],
    '/api/afl/model/disposals/history': [...AFL_DISPOSALS_HISTORY_TRACE_FILES],
    '/api/afl/model/disposals/history/route': [...AFL_DISPOSALS_HISTORY_TRACE_FILES],
    '/api/afl/model/disposals/history/all': [...AFL_DISPOSALS_HISTORY_TRACE_FILES],
    '/api/afl/model/disposals/history/all/route': [...AFL_DISPOSALS_HISTORY_TRACE_FILES],
    '/api/afl/footywire-team-selections': [
      './data/afl-team-selections-snapshot.html',
      './data/afl-team-selections-snapshot.json',
    ],
    '/api/afl/footywire-team-selections/route': [
      './data/afl-team-selections-snapshot.html',
      './data/afl-team-selections-snapshot.json',
    ],
    '/api/afl/injuries': ['./data/afl-injuries.json'],
    '/api/afl/injuries/route': ['./data/afl-injuries.json'],
    '/api/nbl/injuries': ['./data/nbl-injuries.json'],
    '/api/nbl/injuries/route': ['./data/nbl-injuries.json'],
    '/api/nbl/lineups': [...NBL_LINEUP_TRACE],
    '/api/nbl/lineups/route': [...NBL_LINEUP_TRACE],
    '/api/nbl/predicted-starters': [...NBL_LINEUP_TRACE],
    '/api/nbl/predicted-starters/route': [...NBL_LINEUP_TRACE],
    '/api/nbl/player-game-logs': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/player-game-logs/route': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/shot-chart': [...NBL_SHOT_TRACE],
    '/api/nbl/shot-chart/route': [...NBL_SHOT_TRACE],
    '/api/nbl/team-game-logs': [...NBL_PERIOD_TRACE],
    '/api/nbl/team-game-logs/route': [...NBL_PERIOD_TRACE],
    '/api/nbl/play-types': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/play-types/route': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/player-ratings': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/player-ratings/route': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/chemistry': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/chemistry/route': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/team-usage': [...NBL_STATS_TRACE, ...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/team-usage/route': [...NBL_STATS_TRACE, ...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/team-ste-stats': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/team-ste-stats/route': [...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/team-ratings': [...NBL_STATS_TRACE, ...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/team-ratings/route': [...NBL_STATS_TRACE, ...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/similar-players': [...NBL_STATS_TRACE, ...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/similar-players/route': [...NBL_STATS_TRACE, ...NBL_PLAYER_LOG_TRACE],
    '/api/nbl/ladder': [...NBL_STATS_TRACE],
    '/api/nbl/ladder/route': [...NBL_STATS_TRACE],
    '/api/nbl/schedule': [...NBL_STATS_TRACE],
    '/api/nbl/schedule/route': [...NBL_STATS_TRACE],
    '/api/nbl/league-player-stats': [...NBL_STATS_TRACE],
    '/api/nbl/league-player-stats/route': [...NBL_STATS_TRACE],
    '/api/nbl/next-game': [...NBL_STATS_TRACE],
    '/api/nbl/next-game/route': [...NBL_STATS_TRACE],
    '/api/nbl/players': [...NBL_STATS_TRACE],
    '/api/nbl/players/route': [...NBL_STATS_TRACE],
    ...routeTrace(NBL_PROPS_ROUTES, NBL_PROPS_CWD_TRACE),
    ...routeTrace(['/api/nbl/line-movement'], NBL_LINE_MOVEMENT_TRACE),
    ...routeTrace(['/api/nbl/model', '/api/nbl/ask'], NBL_ENGINE_TRACE),
    '/api/tennis/matches': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/matches/route': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/player-matchup': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/player-matchup/route': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/dvp': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/dvp/route': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/players': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/players/route': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/next-game': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/next-game/route': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/player-props/list': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/player-props/list/route': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/headshot/[id]': [...TENNIS_RUNTIME_DATA],
    '/api/tennis/headshot/[id]/route': [...TENNIS_RUNTIME_DATA],
    ...routeTrace(COMBINED_PROPS_ROUTES, COMBINED_PROPS_CWD_TRACE),
    ...routeTrace(AFL_PROPS_ROUTES, AFL_PROPS_CWD_TRACE),
    '/api/cron/ai-picks-run': [...AI_PICKS_RUN_TRACE],
    '/api/cron/ai-picks-run/route': [...AI_PICKS_RUN_TRACE],
    '/api/cron/ai-picks-grade': [...AI_PICKS_GRADE_TRACE],
    '/api/cron/ai-picks-grade/route': [...AI_PICKS_GRADE_TRACE],
    '/api/afl/cron/league-player-stats': [
      './data/afl-league-player-stats-2026.json',
      './data/afl-league-player-stats-2025.json',
      './data/afl-league-player-stats-2024.json',
    ],
    '/api/afl/cron/league-player-stats/route': [
      './data/afl-league-player-stats-2026.json',
      './data/afl-league-player-stats-2025.json',
      './data/afl-league-player-stats-2024.json',
    ],
  },
  // Serve the app icon at /favicon.ico for legacy requests
  async rewrites() {
    return [
      { source: "/favicon.ico", destination: "/images/favicon-32.png" },
    ];
  },
  typescript: {
    // Enable type checking during builds
    // Note: If you need to temporarily disable this during development,
    // use the environment variable: NEXT_TYPESCRIPT_IGNORE_BUILD_ERRORS=true
    ignoreBuildErrors: false,
  },
  experimental: {
    // Keep compiled routes on disk between dev server restarts. Without it every restart compiles
    // each page from scratch on first visit (minutes for /tennis and /props). Dev only.
    turbopackFileSystemCacheForDev: true,
  },
  outputFileTracingExcludes: {
    '/*': [
      './data/afl-model/cache/player-logs/**/*',
      './data/afl-model/models/**/*',
      './data/afl-model/datasets/**/*',
      // Accidental nested duplicate player-log cache committed under data/afl-model/afl-model/
      './data/afl-model/afl-model/**/*',
      './data/afl-model/projections/**/*',
      './data/afl-team-selections-snapshot.html',
      './scripts/afl_model/__pycache__/**/*',
      // Served by the CDN. Routes that build paths from process.cwd() would otherwise bundle all of it;
      // tennis headshots fall back to data/tennis/headshots.json and a redirect to the static file.
      './public/**/*',
      './data/sportsline-*.html',
      './nbl-engine/**/*',
      './tsconfig.tsbuildinfo',
      // Local-only tennis scrapes (~580MB). Never needed in serverless functions.
      './data/tennis/rank-raw/**/*',
      './data/tennis/surface-raw/**/*',
      './data/tennis/api-tennis/cache.json',
    ],
    ...routeTrace(AFL_PROPS_ROUTES, AFL_PROPS_CWD_EXCLUDES),
    ...routeTrace(COMBINED_PROPS_ROUTES, COMBINED_PROPS_CWD_EXCLUDES),
    ...routeTrace(NBL_PROPS_ROUTES, NBL_PROPS_CWD_EXCLUDES),
    ...routeTrace(['/api/nbl/line-movement'], NBL_LINE_MOVEMENT_EXCLUDES),
    ...routeTrace(['/api/nbl/model', '/api/nbl/ask'], NBL_ENGINE_EXCLUDES),
    ...routeTrace(NBL_ANALYTICS_ROUTES, NBL_ANALYTICS_EXCLUDES),
    '/api/cron/ai-picks-run': [...AI_PICKS_RUN_EXCLUDES],
    '/api/cron/ai-picks-run/route': [...AI_PICKS_RUN_EXCLUDES],
    '/api/cron/ai-picks-grade': [...AI_PICKS_GRADE_EXCLUDES],
    '/api/cron/ai-picks-grade/route': [...AI_PICKS_GRADE_EXCLUDES],
  },

  // Only suppress known Supabase auth errors during build phase (not runtime)
  // These are expected errors when Supabase client initializes during static generation
  webpack: (config, { isServer }) => {
    if (isServer) {
      const originalError = console.error;
      console.error = (...args: any[]) => {
        const message = args[0]?.toString() || '';
        // Only suppress specific known Supabase build-time errors
        // This prevents build failures but does not hide runtime errors
        if (
          (message.includes('Invalid Refresh Token') ||
           message.includes('Refresh Token Not Found') ||
           message.includes('AuthApiError')) &&
          process.env.NEXT_PHASE === 'phase-production-build'
        ) {
          return; // Suppress only during build phase
        }
        originalError.apply(console, args);
      };
      // Restore original console.error after webpack config is done
      // Note: This is build-time only, runtime errors are not suppressed
    }
    return config;
  },
  // Add empty turbopack config to silence the warning
  // We're using webpack for now, but this allows the build to proceed
  turbopack: {},
  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.nba.com',
        pathname: '/headshots/**',
      },
      {
        protocol: 'https',
        hostname: 'a.espncdn.com',
        pathname: '/**',
      },
    ],
    // Enable WebP format (automatic with Next.js Image)
    formats: ['image/webp', 'image/avif'],
    // Device sizes for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // Image sizes for different breakpoints
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
};

export default nextConfig;
