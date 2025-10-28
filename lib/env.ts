// Environment variable validation and type-safe access
// Ensures required environment variables are present and provides helpful error messages

/**
 * Required environment variables for the application
 */
const REQUIRED_ENV_VARS = {
  // Supabase (required for authentication and database)
  NEXT_PUBLIC_SUPABASE_URL: 'Supabase project URL',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'Supabase anonymous key',
  
  // Ball Don't Lie API (required for NBA data)
  BALLDONTLIE_API_KEY: 'Ball Don\'t Lie API key',
} as const;

/**
 * Optional environment variables
 */
const OPTIONAL_ENV_VARS = {
  // Odds API (optional, app works without it)
  ODDS_API_KEY: 'The Odds API key for betting lines',
  
  // Base URL (optional, auto-detected in most cases)
  NEXT_PUBLIC_BASE_URL: 'Base URL for API calls',
} as const;

/**
 * Validate that all required environment variables are present
 * Throws detailed error if any are missing
 */
export function validateEnv(): void {
  const missing: string[] = [];
  
  for (const [key, description] of Object.entries(REQUIRED_ENV_VARS)) {
    if (!process.env[key]) {
      missing.push(`${key} (${description})`);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map(v => `  - ${v}`).join('\n')}\n\n` +
      'Please create a .env.local file with these variables.\n' +
      'See .env.example or .env.template for reference.'
    );
  }
}

/**
 * Get environment variable with type safety
 * Throws if required variable is missing
 */
export function getEnv(key: keyof typeof REQUIRED_ENV_VARS): string {
  const value = process.env[key];
  
  // Only throw on server-side or during build - client side might not have process.env
  if (!value && typeof window === 'undefined') {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Description: ${REQUIRED_ENV_VARS[key]}`
    );
  }
  
  return value || '';
}

/**
 * Get optional environment variable
 * Returns undefined if not present
 */
export function getOptionalEnv(key: keyof typeof OPTIONAL_ENV_VARS): string | undefined {
  return process.env[key];
}

/**
 * Check if an optional environment variable is configured
 */
export function hasEnv(key: keyof typeof OPTIONAL_ENV_VARS): boolean {
  return Boolean(process.env[key]);
}

/**
 * Get all configured environment variables (for debugging)
 * Never exposes actual values, just which ones are set
 */
export function getEnvStatus(): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  
  // Check required vars
  for (const key of Object.keys(REQUIRED_ENV_VARS)) {
    status[key] = Boolean(process.env[key]);
  }
  
  // Check optional vars
  for (const key of Object.keys(OPTIONAL_ENV_VARS)) {
    status[key] = Boolean(process.env[key]);
  }
  
  return status;
}

// Validate on module load (server-side only)
if (typeof window === 'undefined') {
  try {
    validateEnv();
  } catch (error) {
    console.error('❌ Environment validation failed:');
    console.error(error);
    // Don't throw during build time, just warn
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}
