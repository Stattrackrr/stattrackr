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
};

export default nextConfig;
