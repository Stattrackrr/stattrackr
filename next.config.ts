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
    '/api/nbl/player-props/list': [
      ...NBL_PLAYER_LOG_TRACE,
      './data/nbl-model/cache/player-prop-lines/**/*',
      './data/nbl-model/cache/player-props-list.json',
    ],
    '/api/nbl/player-props/list/route': [
      ...NBL_PLAYER_LOG_TRACE,
      './data/nbl-model/cache/player-prop-lines/**/*',
      './data/nbl-model/cache/player-props-list.json',
    ],
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
    // Experimental features disabled to avoid build errors
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
    ],
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
