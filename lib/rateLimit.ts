// Rate limiting utility for API routes
// Prevents abuse and protects external API quotas

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 100, windowMinutes: number = 15) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMinutes * 60 * 1000;
    
    // Clean up old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if a request should be allowed
   * @param identifier - Usually IP address or user ID
   * @returns Object with allowed status and remaining requests
   */
  check(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    // No existing entry or expired - allow and create new
    if (!entry || now > entry.resetAt) {
      const newEntry: RateLimitEntry = {
        count: 1,
        resetAt: now + this.windowMs
      };
      this.requests.set(identifier, newEntry);
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt: newEntry.resetAt
      };
    }

    // Existing entry - check if under limit
    if (entry.count < this.maxRequests) {
      entry.count++;
      return {
        allowed: true,
        remaining: this.maxRequests - entry.count,
        resetAt: entry.resetAt
      };
    }

    // Over limit
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt
    };
  }

  /**
   * Reset rate limit for a specific identifier
   */
  reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetAt) {
        this.requests.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Rate limiter cleaned ${cleaned} expired entries`);
    }
  }

  /**
   * Get stats about current rate limiting state
   */
  getStats() {
    const now = Date.now();
    const active = Array.from(this.requests.entries())
      .filter(([_, entry]) => now <= entry.resetAt)
      .length;
    
    return {
      totalTracked: this.requests.size,
      activeWindows: active,
      maxRequests: this.maxRequests,
      windowMs: this.windowMs
    };
  }
}

// Create rate limiters for different tiers
// More lenient in development for testing
const isDev = process.env.NODE_ENV === 'development';
export const apiRateLimiter = new RateLimiter(isDev ? 500 : 100, 15); // 500 dev / 100 prod per 15 minutes
export const strictRateLimiter = new RateLimiter(isDev ? 50 : 10, 1); // 50 dev / 10 prod per minute

/**
 * Extract identifier from request (IP address or user session)
 */
export function getRequestIdentifier(request: Request): string {
  // Try to get IP from various headers
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  
  // Use first IP from forwarded chain
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIp) {
    return realIp;
  }
  
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  
  // Fallback to a default identifier
  return 'unknown';
}

/**
 * Middleware helper to check rate limit and return appropriate response
 */
export function checkRateLimit(
  request: Request,
  limiter: RateLimiter = apiRateLimiter
): { allowed: boolean; response?: Response } {
  const identifier = getRequestIdentifier(request);
  const result = limiter.check(identifier);

  if (!result.allowed) {
    const resetDate = new Date(result.resetAt).toISOString();
    return {
      allowed: false,
      response: new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          resetAt: resetDate,
          message: 'Too many requests. Please try again later.'
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limiter['maxRequests'].toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetDate,
            'Retry-After': Math.ceil((result.resetAt - Date.now()) / 1000).toString()
          }
        }
      )
    };
  }

  return { allowed: true };
}
