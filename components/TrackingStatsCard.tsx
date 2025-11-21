// components/TrackingStatsCard.tsx
"use client";

import React, { useMemo, useState } from 'react';
import { useTrackingStats } from '@/hooks/useTrackingStats';
import { getNbaStatsId, detectIdType, hasMappingFor } from '@/lib/playerIdMapping';

interface TrackingStatsCardProps {
  playerId: string;
  playerName?: string;
  season?: number;
}

type TrackingStatsFilter = 'passing' | 'rebounding';

export function TrackingStatsCard({ playerId, playerName, season }: TrackingStatsCardProps) {
  const [selectedFilter, setSelectedFilter] = useState<TrackingStatsFilter>('passing');
  // Try to convert player ID to NBA Stats format if needed
  const nbaPlayerId = useMemo(() => {
    console.log(`[TrackingStatsCard] 🔍 Looking up player:`, {
      playerId,
      playerName,
      idType: detectIdType(playerId),
      hasMapping: hasMappingFor(playerId)
    });
    
    const converted = getNbaStatsId(playerId);
    const idType = detectIdType(playerId);
    const hasMapping = hasMappingFor(playerId);
    
    if (converted !== playerId) {
      console.log(`[TrackingStats] ✅ Converted player ID: ${playerId} (${idType}) → ${converted} (NBA)`);
    } else if (idType === 'bdl' && !hasMapping) {
      console.warn(`[TrackingStats] ⚠️ MISSING MAPPING for ${playerName}: BDL ID ${playerId} has no NBA Stats ID mapping!`);
      console.warn(`[TrackingStats] Please add this to lib/playerIdMapping.ts:`, {
        player: playerName,
        bdlId: playerId,
        message: 'Find NBA Stats ID and add to mapping'
      });
    } else if (idType === 'unknown') {
      console.warn(`[TrackingStats] ❓ Unknown ID format: ${playerId} - trying anyway`);
    }
    
    return converted || playerId;
  }, [playerId, playerName]);
  
  const { data, loading, error } = useTrackingStats({ 
    playerId: nbaPlayerId, 
    season,
    perMode: 'PerGame'
  });

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Advanced Tracking Stats</h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    // Check if it's a "no data available" error (404)
    const isNoDataError = error.includes('no available tracking stats') || error.includes('404');
    
    // For 404/no data errors, silently hide the component (cleaner UX)
    if (isNoDataError) {
      return null;
    }
    
    // For other errors (500, timeout, etc.), show a warning
    const hasMapping = hasMappingFor(playerId);
    const idType = detectIdType(playerId);
    const isIdConversionIssue = !hasMapping && idType === 'bdl';
    
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Advanced Tracking Stats</h3>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
                Tracking Stats Unavailable
              </p>
              <p className="text-xs text-yellow-800 dark:text-yellow-300 mb-2">
                {error}
              </p>
              {isIdConversionIssue ? (
                <div className="text-xs text-yellow-700 dark:text-yellow-400 space-y-1">
                  <p className="font-semibold">Possible ID Format Issue:</p>
                  <p>
                    This player ID ({playerId}) appears to be from BallDontLie API, but we don't have a mapping to NBA Stats API format yet.
                  </p>
                  <p className="mt-2">
                    Tracking stats are only available for players with known ID mappings. Popular players like LeBron, Giannis, Luka, etc. are already mapped.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-yellow-700 dark:text-yellow-400">
                  The NBA API is having issues. This is temporary and usually resolves within an hour.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data?.passing_stats && !data?.rebounding_stats) {
    // Don't render anything if no data - cleaner UX
    return null;
  }

  const { passing_stats, rebounding_stats } = data;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Advanced Tracking Stats</h3>
          
          {/* Filter Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedFilter('passing')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                selectedFilter === 'passing'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              🎯 Passing
            </button>
            <button
              onClick={() => setSelectedFilter('rebounding')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                selectedFilter === 'rebounding'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              🏀 Rebounding
            </button>
          </div>
        </div>
        
        {playerName && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {playerName} • {data.season} {data.season_type}
          </p>
        )}
      </div>

      <div className="space-y-6">
        {/* Passing Stats */}
        {passing_stats && selectedFilter === 'passing' && (
          <div>
            <h4 className="text-md font-semibold mb-3 text-blue-600 dark:text-blue-400">
              Passing & Playmaking
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatItem
                label="Potential Assists"
                value={passing_stats.POTENTIAL_AST}
                description="Passes that could have been assists"
                highlight
              />
              <StatItem
                label="Actual Assists"
                value={passing_stats.AST_ADJ || data.base_stats?.AST}
                description="Assists recorded"
              />
              <StatItem
                label="Ast Points Created"
                value={passing_stats.AST_PTS_CREATED}
                description="Points created from assists"
                highlight
              />
              <StatItem
                label="Passes Made"
                value={passing_stats.PASSES_MADE}
                description="Total passes per game"
              />
              <StatItem
                label="Assist %"
                value={passing_stats.AST_TO_PASS_PCT}
                isPercentage
                description="Pass to assist conversion"
              />
              <StatItem
                label="Secondary Assists"
                value={passing_stats.SECONDARY_AST}
                description="Hockey assists"
              />
            </div>
          </div>
        )}

        {/* Rebounding Stats */}
        {rebounding_stats && selectedFilter === 'rebounding' && (
          <div>
            <h4 className="text-md font-semibold mb-3 text-green-600 dark:text-green-400">
              Rebounding Tracking
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatItem
                label="Reb Chances"
                value={rebounding_stats.REB_CHANCES}
                description="Rebounding opportunities"
                highlight
              />
              <StatItem
                label="Reb Chance %"
                value={rebounding_stats.REB_CHANCE_PCT}
                isPercentage
                description="Chance conversion rate"
                highlight
              />
              <StatItem
                label="Total Rebounds"
                value={rebounding_stats.REB}
                description="Actual rebounds"
              />
              <StatItem
                label="Contested Reb"
                value={rebounding_stats.REB_CONTEST}
                description="Contested rebounds"
              />
              <StatItem
                label="Uncontested Reb"
                value={rebounding_stats.REB_UNCONTEST}
                description="Uncontested rebounds"
              />
              <StatItem
                label="Contest %"
                value={rebounding_stats.REB_CONTEST_PCT}
                isPercentage
                description="Contested rebound rate"
              />
            </div>

            {/* Offensive vs Defensive Rebounds Breakdown */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded">
                <h5 className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-2">
                  Offensive Rebounds
                </h5>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="font-semibold">{formatValue(rebounding_stats.OREB)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Chances:</span>
                    <span className="font-semibold">{formatValue(rebounding_stats.OREB_CHANCES)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Rate:</span>
                    <span className="font-semibold">{formatValue(rebounding_stats.OREB_CHANCE_PCT, true)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                <h5 className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">
                  Defensive Rebounds
                </h5>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="font-semibold">{formatValue(rebounding_stats.DREB)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Chances:</span>
                    <span className="font-semibold">{formatValue(rebounding_stats.DREB_CHANCES)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Rate:</span>
                    <span className="font-semibold">{formatValue(rebounding_stats.DREB_CHANCE_PCT, true)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: number | null | undefined;
  description?: string;
  isPercentage?: boolean;
  highlight?: boolean;
}

function StatItem({ label, value, description, isPercentage, highlight }: StatItemProps) {
  const formattedValue = formatValue(value, isPercentage);
  
  return (
    <div 
      className={`p-3 rounded-lg ${
        highlight 
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' 
          : 'bg-gray-50 dark:bg-gray-700/50'
      }`}
      title={description}
    >
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
        {label}
      </div>
      <div className={`text-lg font-bold ${
        highlight 
          ? 'text-blue-700 dark:text-blue-300' 
          : 'text-gray-900 dark:text-gray-100'
      }`}>
        {formattedValue}
      </div>
      {description && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
          {description}
        </div>
      )}
    </div>
  );
}

function formatValue(value: number | null | undefined, isPercentage = false): string {
  if (value === null || value === undefined) return 'N/A';
  
  if (isPercentage) {
    return `${(value * 100).toFixed(1)}%`;
  }
  
  return value.toFixed(1);
}

