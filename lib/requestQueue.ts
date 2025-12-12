/**
 * Request Queue Utility
 * Limits concurrent API requests to prevent rate limiting
 * Implements exponential backoff for 429 errors
 */

interface QueuedRequest<T> {
  id: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  retries: number;
  maxRetries: number;
}

class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private processing = false;
  private concurrent = 0;
  private maxConcurrent: number;
  private delayBetweenBatches: number;
  private inFlightRequests: Map<string, Promise<any>> = new Map();

  constructor(maxConcurrent = 2, delayBetweenBatches = 100) {
    this.maxConcurrent = maxConcurrent;
    this.delayBetweenBatches = delayBetweenBatches;
  }

  /**
   * Add a request to the queue
   */
  async enqueue<T>(fn: () => Promise<T>, id?: string): Promise<T> {
    const requestId = id || `req-${Date.now()}-${Math.random()}`;
    const enqueueTime = Date.now();
    
    // Check if this request is already in flight (deduplication)
    if (this.inFlightRequests.has(requestId)) {
      return this.inFlightRequests.get(requestId)!;
    }
    
    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: requestId,
        fn,
        resolve,
        reject,
        retries: 0,
        maxRetries: 1, // Reduced from 3 to 1 to prevent retry cascades
      });
      this.process();
    });
    
    // Track in-flight requests
    this.inFlightRequests.set(requestId, promise);
    promise.finally(() => {
      this.inFlightRequests.delete(requestId);
      const waitTime = Date.now() - enqueueTime;
      if (waitTime > 5000) {
        console.warn(`[RequestQueue] ⚠️ Request waited ${waitTime}ms in queue: ${requestId}`);
      }
    });
    
    return promise;
  }

  /**
   * Process the queue
   */
  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 && this.concurrent < this.maxConcurrent) {
      const request = this.queue.shift();
      if (!request) break;

      // Log if queue is getting backed up
      if (this.queue.length > 10) {
        console.warn(`[RequestQueue] ⚠️ Queue backing up: ${this.queue.length} requests waiting, ${this.concurrent} concurrent`);
      }

      this.concurrent++;
      this.executeRequest(request).finally(() => {
        this.concurrent--;
        // Add delay between batches to avoid rate limiting
        setTimeout(() => this.process(), this.delayBetweenBatches);
      });
    }

    this.processing = false;
  }

  /**
   * Execute a request with retry logic
   */
  private async executeRequest<T>(request: QueuedRequest<T>) {
    try {
      const result = await request.fn();
      request.resolve(result);
    } catch (error: any) {
      // Check if it's a 429 rate limit error
      const isRateLimit = 
        error?.status === 429 || 
        error?.response?.status === 429 ||
        (typeof error === 'string' && error.includes('429'));

      if (isRateLimit && request.retries < request.maxRetries) {
        // Reduced backoff: 2s only (was exponential 1s, 2s, 4s)
        const backoffDelay = 2000;
        console.warn(`[RequestQueue] Rate limited, retrying in ${backoffDelay}ms (attempt ${request.retries + 1}/${request.maxRetries})`);
        
        request.retries++;
        setTimeout(() => {
          this.queue.unshift(request); // Add back to front of queue
          this.process();
        }, backoffDelay);
      } else {
        request.reject(error);
      }
    }
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      concurrent: this.concurrent,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Clear the queue
   */
  clear() {
    this.queue.forEach(req => req.reject(new Error('Queue cleared')));
    this.queue = [];
  }
}

// Global request queue instance (shared across all components)
// Process 5 concurrent requests for faster processing (cache is working correctly now)
// 100ms delay between batches for quick processing
export const requestQueue = new RequestQueue(5, 100);

/**
 * Fetch with automatic queuing and retry logic
 */
export async function queuedFetch(
  url: string,
  options?: RequestInit,
  requestId?: string
): Promise<Response> {
  return requestQueue.enqueue(async () => {
    // 2 minute timeout for all requests - simple and covers all cases
    const timeoutMs = 120000; // 120s (2 minutes)
    
    // Add timeout to prevent hanging requests
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        console.error(`[RequestQueue] ⏱️ Request TIMEOUT after ${timeoutMs/1000}s: ${url}`);
        reject(new Error(`Request timeout: ${url}`));
      }, timeoutMs);
    });
    
    const fetchPromise = fetch(url, options);
    
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    
    // If rate limited, check if response contains cached data before throwing
    if (response.status === 429) {
      // Try to peek at the response body to see if it contains cached data
      // Clone the response so we can read it without consuming it
      const clonedResponse = response.clone();
      try {
        const json = await clonedResponse.json();
        // If the response has data, it's cached data from the API - return it instead of throwing
        if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
          console.log(`[RequestQueue] 429 response contains cached data (${json.data.length} items), returning it`);
          return response; // Return the original response (not cloned)
        }
      } catch (e) {
        // Failed to parse as JSON, or no data - treat as real rate limit error
      }
      
      // No cached data in response - throw error to trigger retry logic
      const error: any = new Error(`Rate limited: ${url}`);
      error.status = 429;
      error.response = response;
      throw error;
    }
    
    return response;
  }, requestId || url);
}

