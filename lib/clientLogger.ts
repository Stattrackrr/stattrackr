/**
 * Client-side logger utility
 * Suppresses console logs in production for public users
 * Logs are still available for developers via secret query parameter or localStorage
 * 
 * To enable logs in production:
 * 1. Add ?debug=your-secret-key to URL (requires NEXT_PUBLIC_DEBUG_SECRET env var)
 * 2. Or in browser console: localStorage.setItem('stattrackr_admin_logs', 'true')
 * 3. Or in browser console: window.stattrackrLogger.enable()
 */

type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

const isDevelopment = 
  typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Check if we're in production (NEXT_PUBLIC env vars are replaced at build time)
const isProduction = process.env.NODE_ENV === 'production';

// Store original console methods before we override them (only if in browser)
let originalConsole: typeof console | null = null;
if (typeof window !== 'undefined') {
  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    error: console.error.bind(console),
  } as typeof console;
}

// Check if logs should be enabled (development or admin override)
function shouldLog(): boolean {
  // Always log in development
  if (isDevelopment) {
    return true;
  }

  // In production, check for admin override
  if (typeof window !== 'undefined') {
    try {
      // Check localStorage for admin flag (set via dev tools or secret)
      const adminLogsEnabled = localStorage.getItem('stattrackr_admin_logs') === 'true';
      if (adminLogsEnabled) {
        return true;
      }

      // Check for secret query parameter (e.g., ?debug=secret-key)
      const urlParams = new URLSearchParams(window.location.search);
      const debugKey = urlParams.get('debug');
      // NEXT_PUBLIC_DEBUG_SECRET is replaced at build time
      if (debugKey && process.env.NEXT_PUBLIC_DEBUG_SECRET && debugKey === process.env.NEXT_PUBLIC_DEBUG_SECRET) {
        // Enable logs and store in localStorage for this session
        localStorage.setItem('stattrackr_admin_logs', 'true');
        return true;
      }
    } catch (e) {
      // localStorage might not be available (private browsing, etc.)
      // Default to suppressing logs
    }
  }

  // Default: suppress logs in production
  return false;
}

class ClientLogger {
  private enabled: boolean;
  private logLevel: LogLevel;

  constructor() {
    this.enabled = shouldLog();
    this.logLevel = (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) || 'log';
  }

  /**
   * Check if logging is enabled
   */
  private canLog(level: LogLevel): boolean {
    if (!this.enabled) {
      return false;
    }

    // Map levels to priority
    const levels: Record<LogLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      log: 3,
      debug: 4,
    };

    const logLevelPriority = levels[this.logLevel] ?? 3;
    const messageLevelPriority = levels[level] ?? 3;

    return messageLevelPriority <= logLevelPriority;
  }

  /**
   * Log a message (suppressed in production unless admin override)
   */
  log(message: string, ...args: any[]): void {
    if (this.canLog('log')) {
      console.log(message, ...args);
    }
  }

  /**
   * Log an error (always visible, but sanitized in production)
   */
  error(message: string, ...args: any[]): void {
    // Errors are always logged, but sanitized in production
    if (isProduction && !this.enabled) {
      // Sanitized error - generic message only
      console.error('An error occurred');
    } else {
      console.error(message, ...args);
    }
  }

  /**
   * Log a warning
   */
  warn(message: string, ...args: any[]): void {
    if (this.canLog('warn')) {
      console.warn(message, ...args);
    }
  }

  /**
   * Log info
   */
  info(message: string, ...args: any[]): void {
    if (this.canLog('info')) {
      console.info(message, ...args);
    }
  }

  /**
   * Log debug (lowest priority)
   */
  debug(message: string, ...args: any[]): void {
    if (this.canLog('debug')) {
      console.debug(message, ...args);
    }
  }

  /**
   * Enable logs programmatically (for admin/dev use)
   */
  enable(): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('stattrackr_admin_logs', 'true');
      this.enabled = true;
      console.log('[Logger] Logs enabled for this session');
    }
  }

  /**
   * Disable logs
   */
  disable(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('stattrackr_admin_logs');
      this.enabled = false;
    }
  }
}

// Create singleton instance
export const clientLogger = new ClientLogger();

// Export convenience functions
export const log = (message: string, ...args: any[]) => clientLogger.log(message, ...args);
export const logError = (message: string, ...args: any[]) => clientLogger.error(message, ...args);
export const logWarn = (message: string, ...args: any[]) => clientLogger.warn(message, ...args);
export const logInfo = (message: string, ...args: any[]) => clientLogger.info(message, ...args);
export const logDebug = (message: string, ...args: any[]) => clientLogger.debug(message, ...args);

// Override console methods in production to suppress logs unless enabled
if (typeof window !== 'undefined' && isProduction && originalConsole) {
  // Store original methods
  const original = originalConsole;
  
  // Override console methods - check shouldLog() dynamically on each call
  console.log = (...args: any[]) => {
    if (shouldLog()) {
      original.log(...args);
    }
  };
  
  console.warn = (...args: any[]) => {
    if (shouldLog()) {
      original.warn(...args);
    }
  };
  
  console.info = (...args: any[]) => {
    if (shouldLog()) {
      original.info(...args);
    }
  };
  
  console.debug = (...args: any[]) => {
    if (shouldLog()) {
      original.debug(...args);
    }
  };
  
  // Keep console.error but show sanitized message in production unless logs enabled
  console.error = (...args: any[]) => {
    if (shouldLog()) {
      original.error(...args);
    } else {
      // Sanitized error - generic message only
      original.error('An error occurred');
    }
  };
}

// Make logger available globally for console access
if (typeof window !== 'undefined') {
  (window as any).stattrackrLogger = clientLogger;
  
  // Also expose enable/disable functions directly
  (window as any).enableLogs = () => clientLogger.enable();
  (window as any).disableLogs = () => clientLogger.disable();
}

