/**
 * TRACKING STATS INTEGRATION EXAMPLES
 * 
 * This file shows different ways to add potential assists and rebounds
 * to your NBA dashboard.
 */

import { useState } from 'react';
import { TrackingStatsCard } from '@/components/TrackingStatsCard';
import { useTrackingStats } from '@/hooks/useTrackingStats';

// ============================================================================
// EXAMPLE 1: Quick Integration - Add Full Card to Dashboard
// ============================================================================

export function Example1_FullCard({ playerId, playerName }: { playerId: string; playerName: string }) {
  return (
    <div className="space-y-6">
      {/* Your existing stats cards */}
      <div>Your existing player stats...</div>
      
      {/* Add this single component to show all tracking stats */}
      <TrackingStatsCard 
        playerId={playerId}
        playerName={playerName}
        season={2024}
      />
    </div>
  );
}

// ============================================================================
// EXAMPLE 2: Add Specific Stats to Existing Layout
// ============================================================================

export function Example2_SpecificStats({ playerId }: { playerId: string }) {
  const { data, loading } = useTrackingStats({ playerId });

  if (loading) return <div>Loading tracking stats...</div>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Your existing stat cards */}
      <StatCard label="Points" value={25.3} />
      <StatCard label="Rebounds" value={8.2} />
      <StatCard label="Assists" value={6.1} />
      
      {/* NEW: Add potential assists */}
      <StatCard 
        label="Potential Assists" 
        value={data?.passing_stats?.POTENTIAL_AST}
        highlight
      />
      
      {/* NEW: Add rebound chances */}
      <StatCard 
        label="Rebound Chances" 
        value={data?.rebounding_stats?.REB_CHANCES}
        highlight
      />
      
      {/* NEW: Add assist points created */}
      <StatCard 
        label="Ast Points Created" 
        value={data?.passing_stats?.AST_PTS_CREATED}
      />
    </div>
  );
}

// ============================================================================
// EXAMPLE 3: Add to Player Comparison
// ============================================================================

export function Example3_Comparison({ 
  player1Id, 
  player2Id 
}: { 
  player1Id: string; 
  player2Id: string; 
}) {
  const player1Stats = useTrackingStats({ playerId: player1Id });
  const player2Stats = useTrackingStats({ playerId: player2Id });

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Player 1 */}
      <div>
        <h3>Player 1</h3>
        <ComparisonStat 
          label="Potential Assists"
          value1={player1Stats.data?.passing_stats?.POTENTIAL_AST}
          value2={player2Stats.data?.passing_stats?.POTENTIAL_AST}
        />
        <ComparisonStat 
          label="Rebound Chances"
          value1={player1Stats.data?.rebounding_stats?.REB_CHANCES}
          value2={player2Stats.data?.rebounding_stats?.REB_CHANCES}
        />
      </div>
      
      {/* Player 2 */}
      <div>
        <h3>Player 2</h3>
        {/* Mirror stats */}
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 4: Add Tooltip/Popover with Tracking Stats
// ============================================================================

export function Example4_TooltipInfo({ playerId }: { playerId: string }) {
  const { data } = useTrackingStats({ playerId, enabled: true });
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button 
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="text-blue-600 hover:text-blue-800"
      >
        ℹ️ Advanced Stats
      </button>
      
      {showTooltip && data && (
        <div className="absolute z-10 bg-white shadow-lg rounded p-4 mt-2">
          <p><strong>Potential Assists:</strong> {data.passing_stats?.POTENTIAL_AST}</p>
          <p><strong>Assist Points:</strong> {data.passing_stats?.AST_PTS_CREATED}</p>
          <p><strong>Rebound Chances:</strong> {data.rebounding_stats?.REB_CHANCES}</p>
          <p><strong>Contested Reb:</strong> {data.rebounding_stats?.REB_CONTEST}</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EXAMPLE 5: Add to Existing Dashboard (Your Specific Use Case)
// ============================================================================

/**
 * In your app/nba/research/dashboard/page.tsx, find where you render
 * your player stats and add this:
 */

export function Example5_DashboardIntegration() {
  // Assuming you have these from your existing dashboard state:
  const selectedPlayer = { id: "203507", name: "Giannis Antetokounmpo" };
  const selectedSeason = 2024;
  
  return (
    <div className="dashboard-layout">
      {/* Your existing components */}
      <div className="left-section">
        {/* Player info, basic stats, etc. */}
      </div>
      
      <div className="main-section">
        {/* Your charts, game logs, etc. */}
        
        {/* ADD THIS SECTION */}
        <section className="mt-6">
          <TrackingStatsCard 
            playerId={selectedPlayer.id}
            playerName={selectedPlayer.name}
            season={selectedSeason}
          />
        </section>
      </div>
      
      <div className="right-section">
        {/* Odds, injuries, etc. */}
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 6: Inline Stats with Icons (Compact Version)
// ============================================================================

export function Example6_CompactStats({ playerId }: { playerId: string }) {
  const { data } = useTrackingStats({ playerId });

  if (!data) return null;

  return (
    <div className="flex gap-4 items-center">
      <div className="flex items-center gap-2">
        <span>🎯</span>
        <span className="text-sm">
          Potential Ast: <strong>{data.passing_stats?.POTENTIAL_AST}</strong>
        </span>
      </div>
      
      <div className="flex items-center gap-2">
        <span>🏀</span>
        <span className="text-sm">
          Reb Chances: <strong>{data.rebounding_stats?.REB_CHANCES}</strong>
        </span>
      </div>
      
      <div className="flex items-center gap-2">
        <span>💪</span>
        <span className="text-sm">
          Contested Reb: <strong>{data.rebounding_stats?.REB_CONTESTED}</strong>
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 7: Direct API Usage (No Hook)
// ============================================================================

export async function Example7_DirectFetch(playerId: string) {
  try {
    const response = await fetch(`/api/tracking-stats?player_id=${playerId}`);
    const data = await response.json();
    
    return {
      potentialAssists: data.passing_stats?.POTENTIAL_AST,
      assistPointsCreated: data.passing_stats?.AST_PTS_CREATED,
      reboundChances: data.rebounding_stats?.REB_CHANCES,
      contestedRebounds: data.rebounding_stats?.REB_CONTESTED,
    };
  } catch (error) {
    console.error('Failed to fetch tracking stats:', error);
    return null;
  }
}

// ============================================================================
// Helper Components
// ============================================================================

function StatCard({ 
  label, 
  value, 
  highlight 
}: { 
  label: string; 
  value?: number | null; 
  highlight?: boolean;
}) {
  return (
    <div className={`p-4 rounded-lg ${highlight ? 'bg-blue-50 border-2 border-blue-500' : 'bg-gray-50'}`}>
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-bold">
        {value !== null && value !== undefined ? value.toFixed(1) : 'N/A'}
      </div>
    </div>
  );
}

function ComparisonStat({ 
  label, 
  value1, 
  value2 
}: { 
  label: string; 
  value1?: number | null; 
  value2?: number | null;
}) {
  const better = (value1 || 0) > (value2 || 0) ? 1 : 2;
  
  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex gap-4">
        <span className={better === 1 ? 'font-bold text-green-600' : ''}>
          {value1?.toFixed(1) || 'N/A'}
        </span>
        <span>vs</span>
        <span className={better === 2 ? 'font-bold text-green-600' : ''}>
          {value2?.toFixed(1) || 'N/A'}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// RECOMMENDED: Start with Example 1 or Example 2
// ============================================================================

/**
 * Quick Start Instructions:
 * 
 * 1. Import the component:
 *    import { TrackingStatsCard } from '@/components/TrackingStatsCard';
 * 
 * 2. Add it to your dashboard page:
 *    <TrackingStatsCard playerId="203507" playerName="Giannis" />
 * 
 * 3. That's it! The component handles everything else.
 * 
 * For more control, use the useTrackingStats hook and build your own UI.
 */

