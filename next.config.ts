import type { NextConfig } from "next";

const chromiumBinTrace = ['./node_modules/@sparticuz/chromium/bin/**/*'] as const;

const nextConfig: NextConfig = {
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // Vercel file tracing omits @sparticuz/chromium/bin/*.br unless explicitly included
  outputFileTracingIncludes: {
    '/api/soccer/player-stats-batch': [...chromiumBinTrace],
    '/api/soccer/player-props-test': [...chromiumBinTrace],
    '/api/afl/model/disposals/top-picks': [
      './data/afl-model/history/**/*',
      './data/afl-model/latest-disposals-projections.json',
      './data/afl-model/projections/disposals-projections-*.json',
    ],
    '/api/afl/model/disposals/top-picks/route': [
      './data/afl-model/history/**/*',
      './data/afl-model/latest-disposals-projections.json',
      './data/afl-model/projections/disposals-projections-*.json',
    ],
    '/api/afl/model/disposals/history': [
      './data/afl-model/history/**/*',
      './data/afl-model/latest-disposals-projections.json',
      './data/afl-model/projections/disposals-projections-*.json',
    ],
    '/api/afl/model/disposals/history/route': [
      './data/afl-model/history/**/*',
      './data/afl-model/latest-disposals-projections.json',
      './data/afl-model/projections/disposals-projections-*.json',
    ],
    '/api/afl/model/disposals/history/all': [
      './data/afl-model/history/**/*',
      './data/afl-model/latest-disposals-projections.json',
      './data/afl-model/projections/disposals-projections-*.json',
    ],
    '/api/afl/model/disposals/history/all/route': [
      './data/afl-model/history/**/*',
      './data/afl-model/latest-disposals-projections.json',
      './data/afl-model/projections/disposals-projections-*.json',
    ],
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
  },
  // Serve the app icon at /favicon.ico for legacy requests
  async rewrites() {
    return [
      { source: "/favicon.ico", destination: "/images/stattrackr-icon.png" },
      { source: "/world-cup/player/:slug", destination: "/world-cup" },
      { source: "/images/world-cup-logo.png", destination: "/api/world-cup/dashboard?logo=1" },
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
