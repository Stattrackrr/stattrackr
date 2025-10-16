import { NextApiRequest, NextApiResponse } from 'next';
import { cache } from '@/lib/cache';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const allKeys = cache.keys();
    
    const stats = {
      totalKeys: allKeys.length,
      size: cache.size,
      keysByType: {
        playerStats: allKeys.filter(k => k.startsWith('player_stats_')).length,
        playerSearch: allKeys.filter(k => k.startsWith('player_search_')).length,
        espnPlayer: allKeys.filter(k => k.startsWith('espn_player_')).length,
        games: allKeys.filter(k => k.startsWith('games_')).length,
        odds: allKeys.filter(k => k.startsWith('odds_')).length,
        advancedStats: allKeys.filter(k => k.startsWith('advanced_stats_')).length,
        depthChart: allKeys.filter(k => k.startsWith('depth_chart_')).length,
        injuries: allKeys.filter(k => k.startsWith('injuries_')).length,
        other: allKeys.filter(k => !k.match(/^(player_stats_|player_search_|espn_player_|games_|odds_|advanced_stats_|depth_chart_|injuries_)/)).length
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error('Error getting cache health:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}