import { AdvancedStats } from './types';

export class BallDontLieAPI {
  private static async fetchWithErrorHandling(url: string, retries = 0): Promise<any> {
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        
        // Handle rate limit (429) with retry logic
        if (response.status === 429) {
          // Parse reset time from error response if available
          let resetAt: number | null = null;
          try {
            const errorData = JSON.parse(errorText);
            if (errorData.resetAt) {
              resetAt = new Date(errorData.resetAt).getTime();
            }
          } catch {
            // If we can't parse, use default backoff
          }
          
          // Calculate wait time: use resetAt if available, otherwise exponential backoff
          const waitTime = resetAt 
            ? Math.max(0, resetAt - Date.now() + 1000) // Add 1 second buffer
            : Math.min(1000 * Math.pow(2, retries), 30000); // Max 30 seconds
          
          // Only retry if we haven't exceeded max retries and wait time is reasonable
          if (retries < 2 && waitTime < 60000) {
            console.warn(`[BallDontLieAPI] Rate limit hit, retrying after ${Math.round(waitTime / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.fetchWithErrorHandling(url, retries + 1);
          }
          
          // If we can't retry, throw a rate limit error
          throw new ApiError({
            message: `Rate limit exceeded. Please try again later.`,
            status: 429,
          });
        }
        
        throw new ApiError({
          message: `API request failed: ${response.status} ${response.statusText} - ${errorText}`,
          status: response.status,
        });
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      throw new ApiError({
        message: error instanceof Error ? error.message : 'Unknown API error',
        status: 0,
      });
    }
  }

  /**
   * Get advanced stats for specific players using internal API route
   * @param playerIds Array of player IDs to fetch stats for
   * @param season Optional season (e.g., "2023", defaults to current season)
   * @param postseason Whether to fetch playoff stats (defaults to false)
   */
  static async getAdvancedStats(
    playerIds: number[],
    season?: string,
    postseason = false
  ): Promise<AdvancedStats[]> {
    const params = new URLSearchParams();
    
    // Add player IDs as comma-separated string
    params.set('player_ids', playerIds.join(','));
    
    // Add optional parameters
    if (season) {
      params.set('season', season);
    }
    
    params.set('postseason', postseason.toString());
    
    // Use our internal API route instead of calling Ball Don't Lie directly
    const url = `/api/advanced-stats?${params.toString()}`;
    
    const response = await this.fetchWithErrorHandling(url);
    
    // Handle the response format - our API route returns the Ball Don't Lie response directly
    if (response.error) {
      throw new ApiError({
        message: response.error,
        status: 500,
      });
    }
    
    return Array.isArray(response.data) ? response.data : [];
  }

  /**
   * Get advanced stats for specific games using internal API route
   * @param gameIds Array of game IDs to fetch stats for
   * @param playerId Optional player ID to filter results (if provided)
   */
  static async getAdvancedStatsByGames(
    gameIds: number[],
    playerId?: number
  ): Promise<any[]> {
    const params = new URLSearchParams();
    
    // Add game IDs as comma-separated string
    params.set('game_ids', gameIds.join(','));
    
    // Add player ID if provided
    if (playerId) {
      params.set('player_ids', String(playerId));
    }
    
    // Use our internal API route
    const url = `/api/advanced-stats?${params.toString()}`;
    
    const response = await this.fetchWithErrorHandling(url);
    
    // Handle the response format - our API route returns the Ball Don't Lie response directly
    if (response.error) {
      throw new ApiError({
        message: response.error,
        status: 500,
      });
    }
    
    return Array.isArray(response.data) ? response.data : [];
  }

}

// Error class for API errors
export class ApiError extends Error {
  status?: number;

  constructor({ message, status }: { message: string; status?: number }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}