/**
 * Server-side logger utility
 * Sends logs from the client to the server terminal
 * This prevents logs from being cleared by React's double render in development
 */

type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

interface LogOptions {
  level?: LogLevel;
  data?: any;
  skipServer?: boolean; // Skip server logging (browser only)
}

class ServerLogger {
  private enabled: boolean;
  private queue: Array<{ level: LogLevel; message: string; data?: any; timestamp: string }> = [];
  private flushing = false;

  constructor() {
    // Only enable in development (check both server and client)
    this.enabled = 
      (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') ||
      (typeof window !== 'undefined' && window.location.hostname === 'localhost');
  }

  /**
   * Send log to server
   */
  private async sendToServer(level: LogLevel, message: string, data?: any) {
    if (!this.enabled || typeof window === 'undefined') return;

    const logEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    // Add to queue
    this.queue.push(logEntry);

    // Flush queue if not already flushing
    if (!this.flushing) {
      this.flush();
    }
  }

  /**
   * Flush queued logs to server
   */
  private async flush() {
    if (this.flushing || this.queue.length === 0) return;

    this.flushing = true;

    try {
      // Send all queued logs
      const logsToSend = [...this.queue];
      this.queue = [];

      // Send in batches to avoid overwhelming the server
      for (const log of logsToSend) {
        try {
          await fetch('/api/debug/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(log),
          });
        } catch (err) {
          // Silently fail - don't break the app if logging fails
        }
      }
    } finally {
      this.flushing = false;

      // If more logs were added while flushing, flush again
      if (this.queue.length > 0) {
        setTimeout(() => this.flush(), 100);
      }
    }
  }

  /**
   * Log a message (both browser console and server terminal)
   */
  log(message: string, options?: LogOptions): void {
    const { level = 'log', data, skipServer = false } = options || {};

    // Always log to browser console
    if (data !== undefined) {
      console[level](message, data);
    } else {
      console[level](message);
    }

    // Also send to server (unless skipped)
    if (!skipServer) {
      this.sendToServer(level, message, data);
    }
  }

  /**
   * Convenience methods
   */
  info(message: string, data?: any): void {
    this.log(message, { level: 'info', data });
  }

  warn(message: string, data?: any): void {
    this.log(message, { level: 'warn', data });
  }

  error(message: string, data?: any): void {
    this.log(message, { level: 'error', data });
  }

  debug(message: string, data?: any): void {
    this.log(message, { level: 'debug', data });
  }
}

// Export singleton instance
export const serverLogger = new ServerLogger();

// Export convenience function
export default serverLogger;

