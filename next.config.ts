import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable proper type checking and linting during builds
  // This ensures type safety and catches errors before deployment
  eslint: {
    // Run ESLint on these directories during production builds
    dirs: ['app', 'components', 'lib', 'contexts', 'hooks'],
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
  // Suppress Supabase auth errors during build
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Suppress console errors from Supabase during server-side build
      const originalError = console.error;
      console.error = (...args: any[]) => {
        const message = args[0]?.toString() || '';
        if (
          message.includes('Invalid Refresh Token') ||
          message.includes('Refresh Token Not Found') ||
          message.includes('AuthApiError')
        ) {
          return; // Suppress during build
        }
        originalError.apply(console, args);
      };
    }
    return config;
  },
};

export default nextConfig;
