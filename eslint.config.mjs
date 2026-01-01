// ESLint configuration for Next.js 16
// Using flat config format with FlatCompat for Next.js compatibility

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "dist/**",
      "build/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
      "public/**",
    ],
  },
  // Note: Next.js ESLint config will be loaded via .eslintrc.json
  // This file ensures ignores are properly set for the flat config format
];
