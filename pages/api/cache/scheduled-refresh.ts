import { NextApiRequest, NextApiResponse } from 'next';
import { cache } from '@/lib/cache';
import { getAllPlayers } from '@/lib/nba';

// Security token for scheduled refresh (set in environment variables)
const REFRESH_TOKEN = process.env.CACHE_REFRESH_TOKEN;

interface RefreshJobConfig {
  name: string;
  enabled: boolean;
  cacheKeys: string[];
  refreshFunction?: () => Promise<void>;
}

// Configuration for different refresh jobs
const REFRESH_JOBS: Record<string, RefreshJobConfig> = {
  player_stats: {
    name: 'Player Stats',
    enabled: true,
    cacheKeys: ['player_stats_*'], // Pattern - will match all player stats keys
    refreshFunction: async () => {
      // Get all active players and refresh their stats
      const players = await getAllPlayers();
      const activePlayerIds = players
        .filter(p => p.is_active)
        .map(p => p.id)
        .slice(0, 100); // Limit to prevent timeout
      
      console.log(`Refreshing stats for ${activePlayerIds.length} active players`);
      
      // Clear existing player stats cache entries
      const cacheKeys = cache.keys();
      const playerStatsKeys = cacheKeys.filter(key => key.startsWith('player_stats_'));
      playerStatsKeys.forEach(key => cache.delete(key));
      
      console.log(`Cleared ${playerStatsKeys.length} existing player stats cache entries`);
    }
  },
  player_search: {
    name: 'Player Search',
    enabled: true,
    cacheKeys: ['player_search_*'],
    refreshFunction: async () => {
      // Clear player search cache - it will be rebuilt on next search
      const cacheKeys = cache.keys();
      const playerSearchKeys = cacheKeys.filter(key => key.startsWith('player_search_'));
      playerSearchKeys.forEach(key => cache.delete(key));
      
      console.log(`Cleared ${playerSearchKeys.length} player search cache entries`);
    }
  },
  espn_player: {
    name: 'ESPN Player Data',
    enabled: true,
    cacheKeys: ['espn_player_*'],
    refreshFunction: async () => {
      // Clear ESPN player cache - it will be rebuilt when needed
      const cacheKeys = cache.keys();
      const espnPlayerKeys = cacheKeys.filter(key => key.startsWith('espn_player_'));
      espnPlayerKeys.forEach(key => cache.delete(key));
      
      console.log(`Cleared ${espnPlayerKeys.length} ESPN player cache entries`);
    }
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authorization token
  const authToken = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
  if (!REFRESH_TOKEN || authToken !== REFRESH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { job, jobs, dryRun = false } = req.body;

  try {
    let jobsToRun: string[] = [];
    
    if (job && typeof job === 'string') {
      // Single job specified
      jobsToRun = [job];
    } else if (jobs && Array.isArray(jobs)) {
      // Multiple jobs specified
      jobsToRun = jobs;
    } else {
      // Default: run all enabled jobs
      jobsToRun = Object.keys(REFRESH_JOBS).filter(key => REFRESH_JOBS[key].enabled);
    }

    const results: Record<string, any> = {};
    
    for (const jobName of jobsToRun) {
      const jobConfig = REFRESH_JOBS[jobName];
      
      if (!jobConfig) {
        results[jobName] = { error: `Job '${jobName}' not found` };
        continue;
      }
      
      if (!jobConfig.enabled) {
        results[jobName] = { skipped: true, reason: 'Job disabled' };
        continue;
      }

      console.log(`${dryRun ? '[DRY RUN] ' : ''}Starting cache refresh job: ${jobConfig.name}`);
      
      try {
        if (dryRun) {
          // In dry run mode, just report what would be done
          const cacheKeys = cache.keys();
          const matchingKeys = jobConfig.cacheKeys.reduce((acc, pattern) => {
            const patternKeys = cacheKeys.filter(key => 
              pattern.endsWith('*') 
                ? key.startsWith(pattern.slice(0, -1))
                : key === pattern
            );
            return [...acc, ...patternKeys];
          }, [] as string[]);
          
          results[jobName] = {
            success: true,
            dryRun: true,
            matchingCacheKeys: matchingKeys.length,
            sampleKeys: matchingKeys.slice(0, 5)
          };
        } else {
          // Run the actual refresh function
          const startTime = Date.now();
          
          if (jobConfig.refreshFunction) {
            await jobConfig.refreshFunction();
          } else {
            // Default behavior: clear matching cache keys
            const cacheKeys = cache.keys();
            const keysToDelete = jobConfig.cacheKeys.reduce((acc, pattern) => {
              const patternKeys = cacheKeys.filter(key => 
                pattern.endsWith('*') 
                  ? key.startsWith(pattern.slice(0, -1))
                  : key === pattern
              );
              return [...acc, ...patternKeys];
            }, [] as string[]);
            
            keysToDelete.forEach(key => cache.delete(key));
          }
          
          const duration = Date.now() - startTime;
          results[jobName] = {
            success: true,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
          };
        }
        
        console.log(`${dryRun ? '[DRY RUN] ' : ''}Completed cache refresh job: ${jobConfig.name}`);
        
      } catch (jobError) {
        console.error(`Error in cache refresh job ${jobConfig.name}:`, jobError);
        results[jobName] = {
          error: jobError instanceof Error ? jobError.message : 'Unknown error',
          timestamp: new Date().toISOString()
        };
      }
    }

    // Log cache statistics
    const totalCacheKeys = cache.keys().length;
    const cacheSize = cache.size;
    
    console.log(`Cache refresh completed. Total cache keys: ${totalCacheKeys}, Cache size: ${cacheSize}`);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cacheStats: {
        totalKeys: totalCacheKeys,
        size: cacheSize
      },
      results
    });

  } catch (error) {
    console.error('Error in scheduled cache refresh:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}