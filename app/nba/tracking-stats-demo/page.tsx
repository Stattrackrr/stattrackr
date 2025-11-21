'use client';

import React, { useState } from 'react';
import { TrackingStatsCard } from '@/components/TrackingStatsCard';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Demo page for NBA Tracking Stats
 * 
 * Visit: /nba/tracking-stats-demo
 * 
 * This page demonstrates the new tracking stats feature including:
 * - Potential Assists
 * - Assist Points Created
 * - Rebound Chances
 * - Contested vs Uncontested Rebounds
 */

// Popular NBA players for testing
const DEMO_PLAYERS = [
  { id: '203507', name: 'Giannis Antetokounmpo', team: 'MIL' },
  { id: '2544', name: 'LeBron James', team: 'LAL' },
  { id: '1629029', name: 'Luka Dončić', team: 'DAL' },
  { id: '1628369', name: 'Jayson Tatum', team: 'BOS' },
  { id: '203081', name: 'Damian Lillard', team: 'MIL' },
  { id: '1630162', name: 'Anthony Edwards', team: 'MIN' },
  { id: '1629630', name: 'Nikola Jokić', team: 'DEN' },
  { id: '203954', name: 'Joel Embiid', team: 'PHI' },
  { id: '201142', name: 'Kevin Durant', team: 'PHX' },
  { id: '201935', name: 'James Harden', team: 'LAC' },
];

export default function TrackingStatsDemoPage() {
  const { isDark } = useTheme();
  const [selectedPlayerId, setSelectedPlayerId] = useState(DEMO_PLAYERS[0].id);
  const [selectedSeason, setSelectedSeason] = useState(2025);
  
  const selectedPlayer = DEMO_PLAYERS.find(p => p.id === selectedPlayerId) || DEMO_PLAYERS[0];

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">
            🏀 NBA Tracking Stats Demo
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Advanced tracking statistics including potential assists, rebound chances, and more.
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Player Selection */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Select Player
              </label>
              <select
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {DEMO_PLAYERS.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} ({player.team})
                  </option>
                ))}
              </select>
            </div>

            {/* Season Selection */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Select Season
              </label>
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(parseInt(e.target.value))}
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value={2025}>2025-26 Season (Current)</option>
                <option value={2024}>2024-25 Season</option>
                <option value={2023}>2023-24 Season</option>
              </select>
            </div>
          </div>
        </div>

        {/* Info Card */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">
            📊 What are Tracking Stats?
          </h3>
          <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
            <li>
              <strong>Potential Assists:</strong> Passes that would be assists if the shot was made
            </li>
            <li>
              <strong>Assist Points Created:</strong> Total points generated from your assists
            </li>
            <li>
              <strong>Rebound Chances:</strong> Number of times you had a rebounding opportunity
            </li>
            <li>
              <strong>Contested Rebounds:</strong> Rebounds grabbed with defenders nearby
            </li>
          </ul>
        </div>

        {/* Tracking Stats Card */}
        <TrackingStatsCard
          playerId={selectedPlayerId}
          playerName={selectedPlayer.name}
          season={selectedSeason}
        />

        {/* Integration Guide */}
        <div className="mt-8 bg-gray-100 dark:bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            🚀 How to Add This to Your Dashboard
          </h3>
          
          <div className="bg-white dark:bg-gray-900 rounded p-4 mb-4 overflow-x-auto">
            <pre className="text-sm text-gray-800 dark:text-gray-200">
{`import { TrackingStatsCard } from '@/components/TrackingStatsCard';

<TrackingStatsCard 
  playerId="${selectedPlayerId}"
  playerName="${selectedPlayer.name}"
  season={${selectedSeason}}
/>`}
            </pre>
          </div>

          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <p>
              <strong>Step 1:</strong> Import the component (already done above)
            </p>
            <p>
              <strong>Step 2:</strong> Add it anywhere in your dashboard where you want to display tracking stats
            </p>
            <p>
              <strong>Step 3:</strong> Pass the player ID, name, and season
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-600">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              📚 For more examples and advanced usage, see:{' '}
              <code className="bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">
                docs/NBA_TRACKING_STATS.md
              </code>
            </p>
          </div>
        </div>

        {/* API Information */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            🔌 API Endpoint
          </h3>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Current Request:
              </p>
              <div className="bg-gray-100 dark:bg-gray-900 rounded p-3 overflow-x-auto">
                <code className="text-sm text-blue-600 dark:text-blue-400">
                  GET /api/tracking-stats?player_id={selectedPlayerId}&season={selectedSeason}
                </code>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Available Parameters:
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                <li><code>player_id</code> (required): NBA player ID</li>
                <li><code>season</code> (optional): Season year, defaults to current</li>
                <li><code>per_mode</code> (optional): PerGame, Totals, or Per36</li>
                <li><code>season_type</code> (optional): Regular Season or Playoffs</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Best Practices */}
        <div className="mt-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 text-yellow-900 dark:text-yellow-200">
            ⚠️ Best Practices (Avoiding Blocks)
          </h3>
          <ul className="text-sm text-yellow-800 dark:text-yellow-300 space-y-2 list-disc list-inside">
            <li>Our API automatically includes proper headers to mimic browser requests</li>
            <li>Responses are cached for 1 hour to reduce API calls</li>
            <li>Rate limiting is enforced server-side</li>
            <li>If fetching multiple players, add 1-2 second delays between requests</li>
            <li>Always use the <code>/api/tracking-stats</code> endpoint, never call NBA directly from client</li>
          </ul>
          <p className="mt-3 text-sm text-yellow-700 dark:text-yellow-300">
            ✅ Following these practices means you won't get blocked by NBA's API
          </p>
        </div>
      </div>
    </div>
  );
}

