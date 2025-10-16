"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import CanvasChart from "./CanvasChart";
import { TeamMatchupBars } from "./components/TeamMatchupBars";
import { normalizeTeamAbbr } from "@/lib/nbaAbbr";
import { TeamMatchupOdds } from "@/components/OddsDisplay";
import PreloadSuggestions from "./PreloadSuggestions";
import { ESPN_NBA_ROSTERS_CURRENT } from "@/lib/espnNbaRostersCurrent";

/* ---- Types moved top-level (avoids TSX parsing quirks) ---- */
type AdvancedStats = Partial<{
  player_efficiency_rating: number; // PIE
  usage_percentage: number;
  pace: number;
  true_shooting_percentage: number;
  effective_field_goal_percentage: number;
  offensive_rating: number;
  defensive_rating: number;
  assist_percentage: number;
  assist_to_turnover_ratio: number;
  turnover_ratio: number;
  rebound_percentage: number;
  defensive_rebound_percentage: number;
  net_rating: number;
}>;

type ClutchStats = Partial<{
  clutch_usage: number;
  clutch_ts: number;
  clutch_ppg: number;
}>;

type ChartPoint = { value: number; dateLabel: string; opponent?: string; fullDate?: string; gameId?: number; minutes?: string | number };
type TeamMatch = { oppAbbr: string; dateISO: string; homeAbbr: string; visitorAbbr: string; gameId: string };

type NameSuggestion = { id: string; full: string; teamAbbr: string | null };


export default function ResearchDashboard() {
  console.log('🔄 ResearchDashboard rendering');
  const [themeDark, setThemeDark] = useState(false);
  const [propLine, setPropLine] = useState(0.5);
  const [timeFilter, setTimeFilter] = useState<'last5' | 'last10' | 'last20' | 'h2h' | 'lastSeason' | 'thisSeason'>('last10');
  // Bump this to force a re-fetch of player data on schedule without user interaction
  const [refreshKey, setRefreshKey] = useState(0);
  // Track last successful data refresh
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
 
  // Persist theme selection
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('dashboard.themeDark') : null;
      if (saved === '1') setThemeDark(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('dashboard.themeDark', themeDark ? '1' : '0');
      }
    } catch {}
  }, [themeDark]);

  // Player selection and advanced stats

  const [adv, setAdv] = useState<AdvancedStats | null>(null);
  const [clutch, setClutch] = useState<ClutchStats | null>(null);
  const [loadingAdv, setLoadingAdv] = useState(false);
  const [loadingClutch, setLoadingClutch] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Simple local search state (no URL changes)
  const [searchName, setSearchName] = useState<string>("");
  const [displayName, setDisplayName] = useState<string | null>(null);
const [nameSuggestions, setNameSuggestions] = useState<NameSuggestion[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  // Cancel token for async search suggestions to avoid reopening dropdown after selection
  const searchReqIdRef = useRef(0);
  // Debounce and abort control for suggestion fetches
  const searchDebounceRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const lastFetchedQueryRef = useRef<string>("");
  const isFetchingSuggestionsRef = useRef<boolean>(false);

  // Legacy helper: get player team from ESPN roster
  const getPlayerTeamLegacy = useCallback((playerName: string): string | null => {
    for (const [abbr, players] of Object.entries(ESPN_NBA_ROSTERS_CURRENT)) {
      if ((players as string[]).includes(playerName)) return abbr;
    }
    return null;
  }, []);

  // Legacy matcher from page.legacy.tsx
  const getPlayerMatchesLegacy = useCallback((query: string): string[] => {
    if (!query || query.trim().length < 2) return [];
    const allPlayers = Object.values(ESPN_NBA_ROSTERS_CURRENT).flat();
    const searchTerm = query.toLowerCase().trim();
    const matches = (allPlayers as string[])
      .filter(player => player.toLowerCase().includes(searchTerm))
      .sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        if (aLower === searchTerm) return -1;
        if (bLower === searchTerm) return 1;
        if (aLower.startsWith(searchTerm) && !bLower.startsWith(searchTerm)) return -1;
        if (!aLower.startsWith(searchTerm) && bLower.startsWith(searchTerm)) return 1;
        return a.localeCompare(b);
      })
      .slice(0, 8);
    return matches;
  }, []);
  // Selected player ID and season for fetching
const [playerId, setPlayerId] = useState<number | null>(null);
const [season, setSeason] = useState<number>(2024);
const [selectedTeamAbbr, setSelectedTeamAbbr] = useState<string | null>(null);
  // Season averages snapshot for quick display (PTS/REB/AST/3PT%)
  const [seasonAverages, setSeasonAverages] = useState<{
    pts: number | null;
    reb: number | null;
    ast: number | null;
    fg3m: number | null;
    fg3_pct: number | null;
  } | null>(null);
  // Value analysis control state
  const [selectedBookmaker, setSelectedBookmaker] = useState<'fanduel' | 'draftkings' | 'betmgm' | 'fanatics'>('fanduel');
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>('american');
  // Value Analysis independent line (bookmaker line), separate from chart line
  const [vaLine, setVaLine] = useState<number>(0.5);

  // ---- Player props lines (placeholder until Odds API is integrated) ----
  type Bookmaker = 'fanduel' | 'draftkings' | 'betmgm' | 'fanatics';
  const ALL_BOOKS: Bookmaker[] = ['fanduel', 'draftkings', 'betmgm', 'fanatics'];
  const [selectedBooks, setSelectedBooks] = useState<Set<Bookmaker>>(new Set(['fanduel']));
  // opening/current per bookmaker per metric; null => N/A
  const [openingLines, setOpeningLines] = useState<Record<Bookmaker, Record<string, number | null>>>(() => ({
    fanduel: {}, draftkings: {}, betmgm: {}, fanatics: {}
  }));
  const [currentLines, setCurrentLines] = useState<Record<Bookmaker, Record<string, number | null>>>(() => ({
    fanduel: {}, draftkings: {}, betmgm: {}, fanatics: {}
  }));

  const supportedPropForMetric = (metric: string): boolean => {
    // Props routinely available; others fallback to N/A until we map them
    return ['pts','reb','ast','fg3m'].includes(metric);
  };


  const toggleBookSelection = (b: Bookmaker) => {
    setSelectedBooks(prev => {
      const n = new Set(prev);
      if (n.has(b)) n.delete(b); else n.add(b);
      // keep at least one selected for usability
      if (n.size === 0) n.add(b);
      return n;
    });
  };
  // Chart metric selector
  const [chartMetric, setChartMetric] = useState<'pts' | 'reb' | 'ast' | 'pra' | 'pr' | 'pa' | 'ra' | 'fg3m' | 'fg3a' | 'fgm' | 'fga' | 'ftm' | 'fta' | 'stl' | 'blk' | 'oreb' | 'dreb' | 'pf' | 'to' | 'min' | 'fg_pct' | 'fg3_pct' | 'ft_pct'>('pts');

  // Reset/update placeholder lines when player/metric changes
  useEffect(() => {
    const metricKey = String(chartMetric);
    const isSupported = supportedPropForMetric(metricKey);
    setOpeningLines(prev => {
      const next = { ...prev } as typeof prev;
      for (const b of ALL_BOOKS) {
        next[b] = { ...(next[b] || {}) } as Record<string, number | null>;
        next[b][metricKey] = null; // Always N/A until real data integrated
      }
      return next;
    });
    setCurrentLines(prev => {
      const next = { ...prev } as typeof prev;
      for (const b of ALL_BOOKS) {
        next[b] = { ...(next[b] || {}) } as Record<string, number | null>;
        next[b][metricKey] = null; // Always N/A until real data integrated
      }
      return next;
    });
  }, [displayName, playerId, chartMetric]);
  // Chart data (from real game logs when available)
  const [chartData, setChartData] = useState<ChartPoint[]>([]);

  // Normalized per-game rows; we derive chart points from this based on metric and timeframe
  const [gameRows, setGameRows] = useState<Array<{
    fullDate: string;
    dateLabel: string;
    opponent?: string;
    minutes?: string | number;
    pts?: number; reb?: number; ast?: number; fg3m?: number; fg3a?: number;
  }>>([]);

  // Depth Chart state management
  const [realDepthChart, setRealDepthChart] = useState<any>(null);
  const [loadingDepthChart, setLoadingDepthChart] = useState(false);
  const [teamRoster, setTeamRoster] = useState<any[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const loadingDepthChartRef = useRef(false);
  const loadingRosterRef = useRef(false);

  // Sync URL with current selection (read-only; no state coupling)
  useEffect(() => {
    try {
      const params = new URLSearchParams();
      if (displayName && displayName.trim()) params.set('player', displayName);
      if (playerId != null) params.set('playerId', String(playerId));
      const qs = params.toString();
      const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', next);
    } catch {
      // no-op
    }
  }, [displayName, playerId, season]);

  const centerRef = useRef<HTMLDivElement | null>(null);
  const [chartMargins, setChartMargins] = useState({ left: 56, right: 24 });
  const [chartHeight, setChartHeight] = useState(420);
  const [barrierWidth, setBarrierWidth] = useState(16); // unused after barrier removal
  const [centerMaxWidth, setCenterMaxWidth] = useState(900); // px, dynamic

  // Fetch real depth chart data from ESPN scraper
  const fetchRealDepthChart = useCallback(async (teamAbbr: string) => {
    if (loadingDepthChartRef.current) return;
    
    console.log(`🕷️ STRICT depth chart fetch for ${teamAbbr}`);
    
    // Validate team abbreviation
    const validTeams = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
                       'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
                       'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'];
    
    if (!validTeams.includes(teamAbbr.toUpperCase())) {
      console.error(`❌ Invalid team abbreviation for depth chart: ${teamAbbr}`);
      setRealDepthChart(null);
      return;
    }
    
    try {
      loadingDepthChartRef.current = true;
      setLoadingDepthChart(true);
      console.log(`🔍 Fetching verified depth chart for ${teamAbbr} (ESPN + NBA.com backup)`);
      
      // Try ESPN first
      const espnResponse = await fetch(`/api/espn-depth-chart?team=${teamAbbr}`);
      const espnData = await espnResponse.json();
      
      // CRITICAL: Verify team in response matches requested team
      if (espnData.team && typeof espnData.team === 'string' && espnData.team.toUpperCase() !== teamAbbr.toUpperCase()) {
        console.error(`❌ ESPN DEPTH CHART TEAM MISMATCH: Expected ${teamAbbr} but got ${espnData.team}`);
      } else {
        // Check if ESPN data is good (only count position arrays, not metadata)
        const espnPlayerCount = espnData.depthChart ? 
          ['PG', 'SG', 'SF', 'PF', 'C'].reduce((sum, pos) => {
            return sum + (Array.isArray(espnData.depthChart[pos]) ? espnData.depthChart[pos].length : 0);
          }, 0) : 0;
        
        if (espnData.success && espnPlayerCount >= 8) {
          console.log(`✅ VERIFIED ESPN depth chart for ${teamAbbr}: ${espnPlayerCount} players`);
          setRealDepthChart({
            ...espnData.depthChart,
            source: 'ESPN',
            quality: 'primary',
            verifiedTeam: teamAbbr.toUpperCase()
          });
          return;
        }
      }
      
      // ESPN failed or had insufficient data, try NBA.com backup
      console.log(`🔄 ESPN insufficient (${espnPlayerCount} players), trying NBA.com backup...`);
      
      const nbaResponse = await fetch(`/api/nba-depth-chart?team=${teamAbbr}`);
      const nbaData = await nbaResponse.json();
      
      // CRITICAL: Verify NBA.com team matches too
      if (nbaData.team && typeof nbaData.team === 'string' && nbaData.team.toUpperCase() !== teamAbbr.toUpperCase()) {
        console.error(`❌ NBA.com DEPTH CHART TEAM MISMATCH: Expected ${teamAbbr} but got ${nbaData.team}`);
      } else {
        const nbaPlayerCount = nbaData.depthChart ? 
          ['PG', 'SG', 'SF', 'PF', 'C'].reduce((sum, pos) => {
            return sum + (Array.isArray(nbaData.depthChart[pos]) ? nbaData.depthChart[pos].length : 0);
          }, 0) : 0;
        
        if (nbaData.success && nbaPlayerCount >= 5) {
          console.log(`✅ VERIFIED NBA.com backup depth chart for ${teamAbbr}: ${nbaPlayerCount} players`);
          setRealDepthChart({
            ...nbaData.depthChart,
            source: 'NBA.com',
            quality: 'backup',
            verifiedTeam: teamAbbr.toUpperCase()
          });
          return;
        }
      }
      
      // Both sources failed
      console.log(`❌ Both ESPN (${espnPlayerCount}) and NBA.com (${nbaPlayerCount}) failed for ${teamAbbr}`);
      setRealDepthChart(null);
      
    } catch (error) {
      console.error('Error fetching depth chart:', error);
      setRealDepthChart(null);
    } finally {
      loadingDepthChartRef.current = false;
      setLoadingDepthChart(false);
    }
  }, []);

  // Create depth chart layout - use real data if available, otherwise return null
  const createDepthChart = useCallback((players: any[]) => {
    // If we have real scraped depth chart data, use it
    if (realDepthChart) {
      // console.log(`📊 Using real ${realDepthChart.source || 'unknown source'} depth chart data`);
      // Map real depth chart players to roster data to get additional info
      const mappedDepthChart: Record<string, any[]> = {
        PG: [],
        SG: [],
        SF: [],
        PF: [],
        C: []
      };
      
      // Filter out metadata and only process position arrays
      const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
      positions.forEach(position => {
        if (realDepthChart[position] && Array.isArray(realDepthChart[position])) {
          realDepthChart[position].forEach((depthPlayer: any, index: number) => {
            // Try to find this player in the roster data
            const rosterPlayer = players.find(p => 
              p.name && depthPlayer.name && (
                p.name.toLowerCase().includes(depthPlayer.name.toLowerCase()) ||
                depthPlayer.name.toLowerCase().includes(p.name.toLowerCase()) ||
                // Also try first/last name matching
                (p.firstName && p.lastName && 
                  `${p.firstName} ${p.lastName}`.toLowerCase() === depthPlayer.name.toLowerCase())
              )
            );
            
            mappedDepthChart[position].push({
              name: depthPlayer.name,
              depth: index + 1,
              jersey: rosterPlayer?.jersey || 'N/A',
              headshot: rosterPlayer?.headshot || null,
              // Include roster data if found
              ...(rosterPlayer || {})
            });
          });
        }
      });
      
      return mappedDepthChart;
    }
    
    // No real depth chart available
    console.log('❌ No real depth chart data available');
    return null;
  }, [realDepthChart]);

  // Fetch team roster data for jersey numbers and additional info
  const fetchTeamRoster = useCallback(async (teamAbbr: string) => {
    if (!teamAbbr || loadingRosterRef.current) return;
    
    const cacheKey = `roster_${teamAbbr}_2024`;
    
    try {
      // Check cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { roster, timestamp, verifiedTeam } = JSON.parse(cached);
          const age = Date.now() - timestamp;
          
          // Use cache if less than 2 hours old and team matches
          if (age < 2 * 60 * 60 * 1000 && verifiedTeam === teamAbbr.toUpperCase()) {
            console.log(`📦 Using cached roster for ${teamAbbr} (${Math.round(age / (60 * 1000))}min old)`);
            setTeamRoster(roster || []);
            return;
          }
        } catch {
          localStorage.removeItem(cacheKey);
        }
      }
      
      loadingRosterRef.current = true;
      setLoadingRoster(true);
      console.log(`🏀 Fetching fresh roster for ${teamAbbr}...`);
      
      // Fetch from ESPN roster endpoint
      const response = await fetch(`/api/espn-roster?team=${teamAbbr}`);
      const data = await response.json();
      
      if (data.success && Array.isArray(data.players)) {
        const sortedPlayers = data.players.sort((a: any, b: any) => {
          // Sort by jersey number if available, otherwise by name
          const jerseyA = parseInt(a.jersey) || 999;
          const jerseyB = parseInt(b.jersey) || 999;
          if (jerseyA !== jerseyB) return jerseyA - jerseyB;
          return (a.name || '').localeCompare(b.name || '');
        });
        
        console.log(`✅ Loaded ${sortedPlayers.length} players for ${teamAbbr}`);
        setTeamRoster(sortedPlayers);
        
        // Cache with team verification
        localStorage.setItem(cacheKey, JSON.stringify({ 
          roster: sortedPlayers, 
          timestamp: Date.now(),
          verifiedTeam: teamAbbr.toUpperCase()
        }));
      } else {
        console.warn(`⚠️ No roster data received for ${teamAbbr}`);
        setTeamRoster([]);
      }
      
    } catch (error) {
      console.error(`Error fetching roster for ${teamAbbr}:`, error);
      setTeamRoster([]);
    } finally {
      loadingRosterRef.current = false;
      setLoadingRoster(false);
    }
  }, []);

  // Stat selector scroll (native scrollbar)
  const statScrollRef = useRef<HTMLDivElement | null>(null);

  // Strip any query parameters from the URL on mount (ignore ?player, etc.)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Unified panel height matches the chart container (p-3 => 24px vertical padding)
  const containerPadY = 24;
  const panelHeight = chartHeight + containerPadY;
  // Half panel height for stacked side cards
  const halfPanelHeight = useMemo(() => Math.max(160, Math.floor(panelHeight / 2) - 8), [panelHeight]);
  // Top container uses a smaller height than the main panels


  const [opponentTeam, setOpponentTeam] = useState<string>("");
  const [playerTeam, setPlayerTeam] = useState<string>("");
  const [playerTeamId, setPlayerTeamId] = useState<number | null>(null);
  const [nextMatch, setNextMatch] = useState<TeamMatch | null>(null);
  const [playerBio, setPlayerBio] = useState<{ name: string; heightFeet: number | null; heightInches: number | null; position: string | null } | null>(null);

  // Team ratings (2024-25 snapshot) for matchup box
  const teamRatings: Record<string, { offensive: number; defensive: number; net?: number }> = {
    CLE: { offensive: 121.0, defensive: 111.8 },
    BOS: { offensive: 119.5, defensive: 110.1 },
    OKC: { offensive: 119.2, defensive: 106.6 },
    DEN: { offensive: 118.9, defensive: 115.1 },
    NYK: { offensive: 117.3, defensive: 113.3 },
    MEM: { offensive: 117.2, defensive: 112.6 },
    SAC: { offensive: 115.9, defensive: 115.3 },
    MIN: { offensive: 115.7, defensive: 110.8 },
    IND: { offensive: 115.4, defensive: 113.3 },
    MIL: { offensive: 115.1, defensive: 112.7 },
    LAL: { offensive: 115.0, defensive: 113.8 },
    HOU: { offensive: 114.9, defensive: 110.3 },
    PHX: { offensive: 114.7, defensive: 117.7 },
    DET: { offensive: 114.6, defensive: 112.5 },
    LAC: { offensive: 114.3, defensive: 109.4 },
    GSW: { offensive: 114.2, defensive: 111.0 },
    ATL: { offensive: 113.7, defensive: 114.8 },
    DAL: { offensive: 113.7, defensive: 115.0 },
    SAS: { offensive: 113.5, defensive: 116.3 },
    CHI: { offensive: 113.2, defensive: 114.8 },
    MIA: { offensive: 112.4, defensive: 112.0 },
    POR: { offensive: 111.0, defensive: 113.7 },
    PHI: { offensive: 111.0, defensive: 117.3 },
    UTA: { offensive: 110.2, defensive: 119.4 },
    NOP: { offensive: 109.7, defensive: 119.1 },
    TOR: { offensive: 109.6, defensive: 113.6 },
    ORL: { offensive: 108.9, defensive: 109.1 },
    BKN: { offensive: 108.1, defensive: 115.4 },
    CHA: { offensive: 106.7, defensive: 115.7 },
    WAS: { offensive: 105.8, defensive: 118.0 },
  };
  Object.keys(teamRatings).forEach((t) => { teamRatings[t].net = teamRatings[t].offensive - teamRatings[t].defensive; });

  // Team pace (2024-25 snapshot)
  const teamPace: Record<string, number> = {
    MEM: 103.69, CHI: 103.61, ATL: 103.41, WAS: 101.82, OKC: 100.90,
    UTA: 100.85, IND: 100.76, DEN: 100.67, TOR: 100.62, CLE: 100.31,
    DET: 100.27, DAL: 100.15, SAS: 100.08, MIL: 99.92, NOP: 99.77,
    POR: 99.51, GSW: 99.37, HOU: 99.03, SAC: 98.91, LAL: 98.34,
    PHX: 98.31, LAC: 98.24, CHA: 98.22, PHI: 98.13, MIN: 97.95,
    NYK: 97.64, MIA: 97.08, BKN: 96.73, BOS: 96.59, ORL: 96.51,
  };

  // Team rebound percentage (2024-25 snapshot)
  const teamReboundPct: Record<string, number> = {
    MEM: 58.8, CHI: 58.5, ATL: 57.9, WAS: 54.6, OKC: 59.3,
    UTA: 56.8, IND: 59.4, DEN: 60.4, TOR: 55.3, CLE: 60.7,
    DET: 58.0, DAL: 58.3, SAS: 57.5, MIL: 59.8, NOP: 55.2,
    POR: 55.5, GSW: 56.8, HOU: 55.3, SAC: 58.2, LAL: 59.3,
    PHX: 59.5, LAC: 58.9, CHA: 53.7, PHI: 56.3, MIN: 58.8,
    NYK: 58.9, MIA: 57.6, BKN: 55.2, BOS: 59.1, ORL: 55.0,
  };

  // Static opponent defensive stats (daily manual update supported)
  const opponentDefensiveStats: Record<
    string,
    {
      ptsAllowed: number;
      rebAllowed: number;
      astAllowed: number;
      fgmAllowed: number;
      fgaAllowed: number;
      fg3mAllowed: number;
      fg3aAllowed: number;
      stlAllowed: number;
      blkAllowed: number;
    }
  > = {
    OKC: { ptsAllowed: 107.6, rebAllowed: 44.9, astAllowed: 24.6, fgmAllowed: 37.9, fgaAllowed: 87.0, fg3mAllowed: 13.5, fg3aAllowed: 39.3, stlAllowed: 6.7, blkAllowed: 4.8 },
    CLE: { ptsAllowed: 112.4, rebAllowed: 43.5, astAllowed: 25.6, fgmAllowed: 41.2, fgaAllowed: 90.9, fg3mAllowed: 13.5, fg3aAllowed: 37.5, stlAllowed: 7.8, blkAllowed: 4.4 },
    BOS: { ptsAllowed: 107.2, rebAllowed: 43.7, astAllowed: 24.0, fgmAllowed: 40.3, fgaAllowed: 89.4, fg3mAllowed: 12.9, fg3aAllowed: 37.1, stlAllowed: 6.9, blkAllowed: 3.6 },
    HOU: { ptsAllowed: 109.8, rebAllowed: 42.1, astAllowed: 23.5, fgmAllowed: 40.5, fgaAllowed: 88.3, fg3mAllowed: 12.3, fg3aAllowed: 34.5, stlAllowed: 7.9, blkAllowed: 5.7 },
    NYK: { ptsAllowed: 111.7, rebAllowed: 41.8, astAllowed: 25.2, fgmAllowed: 41.6, fgaAllowed: 87.7, fg3mAllowed: 13.1, fg3aAllowed: 35.7, stlAllowed: 7.0, blkAllowed: 5.0 },
    DEN: { ptsAllowed: 116.9, rebAllowed: 42.5, astAllowed: 29.0, fgmAllowed: 43.3, fgaAllowed: 93.0, fg3mAllowed: 14.1, fg3aAllowed: 38.7, stlAllowed: 8.7, blkAllowed: 5.1 },
    IND: { ptsAllowed: 115.1, rebAllowed: 45.0, astAllowed: 26.0, fgmAllowed: 42.6, fgaAllowed: 89.9, fg3mAllowed: 12.9, fg3aAllowed: 36.3, stlAllowed: 7.2, blkAllowed: 4.5 },
    LAC: { ptsAllowed: 108.2, rebAllowed: 41.5, astAllowed: 25.7, fgmAllowed: 39.5, fgaAllowed: 85.8, fg3mAllowed: 13.0, fg3aAllowed: 37.0, stlAllowed: 8.8, blkAllowed: 4.3 },
    LAL: { ptsAllowed: 112.2, rebAllowed: 43.0, astAllowed: 27.3, fgmAllowed: 41.4, fgaAllowed: 89.3, fg3mAllowed: 13.6, fg3aAllowed: 38.1, stlAllowed: 8.2, blkAllowed: 4.2 },
    MIN: { ptsAllowed: 109.3, rebAllowed: 42.9, astAllowed: 24.8, fgmAllowed: 40.5, fgaAllowed: 88.0, fg3mAllowed: 12.7, fg3aAllowed: 36.0, stlAllowed: 8.4, blkAllowed: 4.5 },
    GSW: { ptsAllowed: 110.5, rebAllowed: 44.1, astAllowed: 25.9, fgmAllowed: 40.4, fgaAllowed: 86.9, fg3mAllowed: 13.2, fg3aAllowed: 36.3, stlAllowed: 7.6, blkAllowed: 5.4 },
    MEM: { ptsAllowed: 116.9, rebAllowed: 43.5, astAllowed: 27.0, fgmAllowed: 41.9, fgaAllowed: 91.8, fg3mAllowed: 14.2, fg3aAllowed: 39.4, stlAllowed: 8.7, blkAllowed: 5.5 },
    MIL: { ptsAllowed: 113.0, rebAllowed: 45.3, astAllowed: 26.4, fgmAllowed: 41.6, fgaAllowed: 91.1, fg3mAllowed: 13.9, fg3aAllowed: 39.4, stlAllowed: 7.3, blkAllowed: 3.8 },
    DET: { ptsAllowed: 113.6, rebAllowed: 42.5, astAllowed: 24.8, fgmAllowed: 40.6, fgaAllowed: 87.9, fg3mAllowed: 13.6, fg3aAllowed: 37.2, stlAllowed: 8.9, blkAllowed: 5.0 },
    ORL: { ptsAllowed: 105.5, rebAllowed: 42.1, astAllowed: 22.8, fgmAllowed: 38.1, fgaAllowed: 81.5, fg3mAllowed: 11.4, fg3aAllowed: 31.4, stlAllowed: 7.7, blkAllowed: 4.4 },
    ATL: { ptsAllowed: 119.3, rebAllowed: 43.7, astAllowed: 28.2, fgmAllowed: 43.4, fgaAllowed: 90.2, fg3mAllowed: 14.3, fg3aAllowed: 37.8, stlAllowed: 9.2, blkAllowed: 4.9 },
    SAC: { ptsAllowed: 115.3, rebAllowed: 42.3, astAllowed: 27.0, fgmAllowed: 41.6, fgaAllowed: 87.8, fg3mAllowed: 14.5, fg3aAllowed: 38.2, stlAllowed: 7.9, blkAllowed: 4.3 },
    CHI: { ptsAllowed: 119.4, rebAllowed: 46.1, astAllowed: 28.9, fgmAllowed: 44.4, fgaAllowed: 95.0, fg3mAllowed: 13.6, fg3aAllowed: 39.6, stlAllowed: 8.1, blkAllowed: 5.1 },
    DAL: { ptsAllowed: 115.4, rebAllowed: 45.3, astAllowed: 27.1, fgmAllowed: 43.1, fgaAllowed: 91.7, fg3mAllowed: 12.9, fg3aAllowed: 35.4, stlAllowed: 8.1, blkAllowed: 4.6 },
    MIA: { ptsAllowed: 110.0, rebAllowed: 44.7, astAllowed: 26.5, fgmAllowed: 41.3, fgaAllowed: 88.6, fg3mAllowed: 13.6, fg3aAllowed: 37.9, stlAllowed: 7.5, blkAllowed: 4.7 },
    PHX: { ptsAllowed: 116.6, rebAllowed: 44.2, astAllowed: 27.3, fgmAllowed: 42.6, fgaAllowed: 90.1, fg3mAllowed: 14.2, fg3aAllowed: 38.4, stlAllowed: 8.5, blkAllowed: 4.0 },
    POR: { ptsAllowed: 113.9, rebAllowed: 44.2, astAllowed: 26.2, fgmAllowed: 41.6, fgaAllowed: 88.3, fg3mAllowed: 12.7, fg3aAllowed: 35.2, stlAllowed: 9.5, blkAllowed: 5.5 },
    SAS: { ptsAllowed: 116.7, rebAllowed: 46.2, astAllowed: 28.0, fgmAllowed: 43.8, fgaAllowed: 92.5, fg3mAllowed: 14.4, fg3aAllowed: 39.3, stlAllowed: 8.1, blkAllowed: 4.3 },
    TOR: { ptsAllowed: 115.2, rebAllowed: 45.0, astAllowed: 25.9, fgmAllowed: 41.2, fgaAllowed: 88.3, fg3mAllowed: 13.2, fg3aAllowed: 37.7, stlAllowed: 9.2, blkAllowed: 5.9 },
    BKN: { ptsAllowed: 112.2, rebAllowed: 43.7, astAllowed: 27.1, fgmAllowed: 40.5, fgaAllowed: 84.3, fg3mAllowed: 12.9, fg3aAllowed: 35.7, stlAllowed: 8.0, blkAllowed: 5.6 },
    PHI: { ptsAllowed: 115.8, rebAllowed: 45.5, astAllowed: 28.3, fgmAllowed: 42.4, fgaAllowed: 86.8, fg3mAllowed: 14.2, fg3aAllowed: 37.6, stlAllowed: 7.4, blkAllowed: 5.1 },
    NOP: { ptsAllowed: 119.3, rebAllowed: 45.7, astAllowed: 28.6, fgmAllowed: 43.7, fgaAllowed: 90.5, fg3mAllowed: 14.6, fg3aAllowed: 41.1, stlAllowed: 9.0, blkAllowed: 5.2 },
    CHA: { ptsAllowed: 114.2, rebAllowed: 45.2, astAllowed: 26.8, fgmAllowed: 41.6, fgaAllowed: 88.9, fg3mAllowed: 14.2, fg3aAllowed: 40.0, stlAllowed: 8.8, blkAllowed: 5.3 },
    WAS: { ptsAllowed: 120.4, rebAllowed: 48.9, astAllowed: 28.5, fgmAllowed: 43.7, fgaAllowed: 92.8, fg3mAllowed: 14.3, fg3aAllowed: 39.2, stlAllowed: 9.1, blkAllowed: 5.2 },
    UTA: { ptsAllowed: 121.2, rebAllowed: 44.2, astAllowed: 29.6, fgmAllowed: 44.6, fgaAllowed: 93.0, fg3mAllowed: 14.9, fg3aAllowed: 41.5, stlAllowed: 9.8, blkAllowed: 6.4 },
  };

  const getOpponentDefensiveValue = (teamAbbr: string, stat: keyof (typeof opponentDefensiveStats)["OKC"]) => {
    const key = String(teamAbbr || "").toUpperCase();
    return opponentDefensiveStats[key]?.[stat] ?? null;
  };

  const getOpponentDefensiveRank = (
    teamAbbr: string,
    stat: keyof (typeof opponentDefensiveStats)["OKC"]
  ) => {
    const list = Object.entries(opponentDefensiveStats).map(([team, s]) => ({
      team,
      value: (s as any)[stat] ?? 999,
    }));
    list.sort((a, b) => a.value - b.value); // lower is better
    const idx = list.findIndex((x) => x.team === String(teamAbbr || "").toUpperCase());
    return idx >= 0 ? idx + 1 : null;
  };

  const getOpponentDefensiveRankColor = (rank: number | null | undefined) => {
    if (!rank || isNaN(Number(rank))) return themeDark ? "text-slate-400" : "text-slate-500";
    if (rank >= 25) return "text-green-500";
    if (rank >= 19) return "text-green-400";
    if (rank >= 13) return "text-orange-500";
    if (rank >= 7) return "text-red-400";
    return "text-red-500";
  };

  // Team rating/rank helpers for matchup
  const getTeamRating = (abbr?: string | null, type?: 'offensive' | 'defensive' | 'net'): number => {
    const k = normalizeAbbr(abbr);
    if (!k || !type) return 0;
    const r = teamRatings[k];
    return (r && (type === 'net' ? (r.net ?? (r.offensive - r.defensive)) : r[type])) || 0;
  };
  const getTeamRank = (abbr?: string | null, type?: 'offensive' | 'defensive' | 'net'): number | null => {
    const k = normalizeAbbr(abbr);
    if (!k || !type) return null;
    const arr = Object.entries(teamRatings).map(([team, r]) => ({ team, val: type === 'net' ? (r.net ?? (r.offensive - r.defensive)) : r[type] }));
    arr.sort((a, b) => type === 'defensive' ? a.val - b.val : b.val - a.val);
    const i = arr.findIndex(x => x.team === k);
    return i >= 0 ? i + 1 : null;
  };
  const getPaceRank = (abbr?: string | null): number | null => {
    const k = normalizeAbbr(abbr);
    if (!k) return null;
    const arr = Object.entries(teamPace).map(([team, pace]) => ({ team, pace }));
    arr.sort((a, b) => b.pace - a.pace);
    const i = arr.findIndex(x => x.team === k);
    return i >= 0 ? i + 1 : null;
  };
  const getTeamPaceVal = (abbr?: string | null): number | null => {
    const k = normalizeAbbr(abbr);
    return (k && teamPace[k] != null) ? teamPace[k] : null;
  };
  const getReboundRank = (abbr?: string | null): number | null => {
    const k = normalizeAbbr(abbr);
    if (!k) return null;
    const arr = Object.entries(teamReboundPct).map(([team, rp]) => ({ team, rp }));
    arr.sort((a, b) => b.rp - a.rp);
    const i = arr.findIndex(x => x.team === k);
    return i >= 0 ? i + 1 : null;
  };
  const getTeamReboundPctVal = (abbr?: string | null): number | null => {
    const k = normalizeAbbr(abbr);
    return (k && teamReboundPct[k] != null) ? teamReboundPct[k] : null;
  };
  const getRankColor = (rank: number | null | undefined, type: 'offensive' | 'defensive' | 'net' | 'pace' | 'rebound' | 'opponent_rebound' | 'opponent_net'): string => {
    if (!rank) return themeDark ? 'text-slate-400' : 'text-slate-500';
    if (type === 'offensive' || type === 'net' || type === 'pace' || type === 'rebound') {
      if (rank <= 6) return 'text-green-500';
      if (rank <= 12) return 'text-green-400';
      if (rank <= 18) return 'text-orange-500';
      if (rank <= 24) return 'text-red-400';
      return 'text-red-500';
    } else if (type === 'opponent_rebound' || type === 'opponent_net') {
      if (rank >= 25) return 'text-green-500';
      if (rank >= 19) return 'text-green-400';
      if (rank >= 13) return 'text-orange-500';
      if (rank >= 7) return 'text-red-400';
      return 'text-red-500';
    } else {
      if (rank >= 25) return 'text-green-500';
      if (rank >= 19) return 'text-green-400';
      if (rank >= 13) return 'text-orange-500';
      if (rank >= 7) return 'text-red-400';
      return 'text-red-500';
    }
  };
  const getOrdinalSuffix = (n: number) => {
    const j = n % 10,
      k = n % 100;
    if (j === 1 && k !== 11) return n + "st";
    if (j === 2 && k !== 12) return n + "nd";
    if (j === 3 && k !== 13) return n + "rd";
    return n + "th";
  };

  // ---- Stat info helpers and tooltip component ----
  const leagueAvg = {
    pie: 0.100,
    usage: 0.210,
    pace: 99.5,
    ts: 0.580,
    efg: 0.547,
    off: 114.0,
    def: 114.0,
    astPct: 0.160,
    astTo: 1.80,
    tovRatio: 0.120,
    trbPct: 0.108,
    drbPct: 0.140,
    net: 0.0,
    clutchUsage: 0.200,
    clutchTs: 0.570,
    clutchPpg: 3.0,
  } as const;

  // Height overrides for players missing from ESPN payloads
  const PLAYER_HEIGHT_OVERRIDES: Record<string, { feet: number; inches: number; position?: string | null }> = {
    'Seth Curry': { feet: 6, inches: 2, position: 'SG' },
  };

  const DESC: Record<string, string> = {
    pie: "Player Impact Estimate – share of total game stats contributed by the player (NBA.com metric).",
    usage: "Usage Rate – estimated % of team possessions the player ends while on the floor.",
    pace: "Pace – team possessions per 48 minutes while the player is on the court.",
    ts: "True Shooting % – shooting efficiency including 2PT, 3PT and FT (PTS / [2*(FGA + 0.44*FTA)]).",
    efg: "Effective FG% – adjusts FG% to weigh 3PT shots by 1.5 (FGM + 0.5*3PM) / FGA.",
    off: "Offensive Rating – points produced per 100 possessions while on court.",
    def: "Defensive Rating – points allowed per 100 possessions while on court (lower is better).",
    astPct: "Assist % – % of teammate FGM assisted by the player while on court.",
    astTo: "AST/TO Ratio – assists divided by turnovers.",
    tovRatio: "Turnover Ratio – turnovers per possession used (per 1.0 = 100%).",
    trbPct: "Total Rebound % – % of available rebounds a player grabbed while on court.",
    drbPct: "Defensive Rebound % – % of available defensive rebounds a player grabbed.",
    net: "Net Rating – Offensive Rating minus Defensive Rating (positive is good).",
    clutchUsage: "Clutch Usage – usage rate in clutch minutes (score within 5, last 5 min).",
    clutchTs: "Clutch True Shooting % – TS% in clutch minutes.",
    clutchPpg: "Clutch PPG – points per game in clutch minutes.",
  };

  const fmtAvg = (k: keyof typeof leagueAvg) => {
    const v = leagueAvg[k];
    switch (k) {
      case 'usage':
      case 'ts':
      case 'efg':
      case 'astPct':
      case 'trbPct':
      case 'drbPct':
      case 'clutchUsage':
      case 'clutchTs':
        return `${(v * 100).toFixed(1)}%`;
      case 'pie':
      case 'tovRatio':
        return v.toFixed(3);
      case 'astTo':
      case 'clutchPpg':
        return v.toFixed(1);
      case 'off':
      case 'def':
      case 'pace':
      case 'net':
        return v.toFixed(1);
      default:
        return String(v);
    }
  };

  // Value color coding helper (green good, orange mid, red bad)
  const colorByRelative = (
    value: number | null | undefined,
    avg: number | null | undefined,
    options?: { invert?: boolean; tol?: number }
  ) => {
    if (value == null || avg == null || !isFinite(value) || !isFinite(avg) || avg === 0) {
      return themeDark ? 'text-slate-300' : 'text-slate-700';
    }
    const invert = options?.invert === true;
    const tol = options?.tol ?? 0.05; // 5% band as mid
    const ratio = invert ? avg / value : value / avg;
    if (ratio >= 1 + tol) return 'text-green-500';
    if (ratio >= 1 - tol) return 'text-orange-500';
    return 'text-red-500';
  };

  const colorForMetric = (
    key:
      | 'pie' | 'usage' | 'pace' | 'ts' | 'efg' | 'off' | 'def' | 'astPct' | 'astTo' | 'tovRatio'
      | 'trbPct' | 'drbPct' | 'net' | 'clutchUsage' | 'clutchTs' | 'clutchPpg',
    value: number | null | undefined
  ): string => {
    if (value == null || !isFinite(value as number)) return themeDark ? 'text-slate-300' : 'text-slate-700';
    switch (key) {
      case 'pie':
        return colorByRelative(value, leagueAvg.pie, { tol: 0.07 });
      case 'usage':
        return colorByRelative(value, leagueAvg.usage, { tol: 0.08 });
      case 'pace':
        return colorByRelative(value, leagueAvg.pace, { tol: 0.03 });
      case 'ts':
        return colorByRelative(value, leagueAvg.ts, { tol: 0.03 });
      case 'efg':
        return colorByRelative(value, leagueAvg.efg, { tol: 0.03 });
      case 'off':
        return colorByRelative(value, leagueAvg.off, { tol: 0.02 });
      case 'def':
        return colorByRelative(value, leagueAvg.def, { invert: true, tol: 0.02 });
      case 'astPct':
        return colorByRelative(value, leagueAvg.astPct, { tol: 0.06 });
      case 'astTo': {
        // AST/TO: higher is better; use explicit bands around league avg 1.8
        if (value >= 2.2) return 'text-green-500';
        if (value >= 1.6) return 'text-orange-500';
        return 'text-red-500';
      }
      case 'tovRatio':
        // Lower is better
        return colorByRelative(value, leagueAvg.tovRatio, { invert: true, tol: 0.05 });
      case 'trbPct':
        return colorByRelative(value, leagueAvg.trbPct, { tol: 0.06 });
      case 'drbPct':
        return colorByRelative(value, leagueAvg.drbPct, { tol: 0.06 });
      case 'net': {
        // Net rating centered at 0
        if (value >= 3) return 'text-green-500';
        if (value <= -3) return 'text-red-500';
        return 'text-orange-500';
      }
      case 'clutchUsage':
        return colorByRelative(value, leagueAvg.clutchUsage, { tol: 0.10 });
      case 'clutchTs':
        return colorByRelative(value, leagueAvg.clutchTs, { tol: 0.05 });
      case 'clutchPpg':
        return colorByRelative(value, leagueAvg.clutchPpg, { tol: 0.15 });
      default:
        return themeDark ? 'text-slate-300' : 'text-slate-700';
    }
  };

  const Info = ({ desc, avg }: { desc: string; avg: string }) => (
    <span className="relative group inline-flex items-center ml-1 align-middle">
      <span className={`inline-flex items-center justify-center w-3 h-3 text-[9px] leading-none rounded-full border ${themeDark ? 'text-slate-400 border-slate-500' : 'text-slate-500 border-slate-400'}`}>i</span>
      <div className={`pointer-events-none invisible group-hover:visible absolute left-full -top-1 ml-2 -translate-y-full w-44 p-2 rounded-md shadow-lg border text-xs transition-transform duration-100 group-hover:scale-95 z-[9999] ${themeDark ? 'bg-slate-900 text-slate-200 border-slate-700' : 'bg-white text-slate-800 border-slate-200'}`}>
        <div className="mb-1">{desc}</div>
        <div className={`${themeDark ? 'text-slate-400' : 'text-slate-500'} text-[10px]`}>NBA average = {avg}</div>
      </div>
    </span>
  );

  // ResizeObserver to compute chart sizing from center container width
  useEffect(() => {
    if (!centerRef.current || typeof ResizeObserver === "undefined") return;
    const el = centerRef.current;

    const computeFromWidth = (w: number) => {
      // Margins scale with container width to keep labels readable
      let left = 48,
        right = 20;
      if (w < 520) {
        left = 40;
        right = 18;
      } else if (w < 768) {
        left = 48;
        right = 22;
      } else if (w < 960) {
        left = 54;
        right = 26;
      } else if (w < 1200) {
        left = 58;
        right = 30;
      } else {
        left = 64;
        right = 32;
      }
      setChartMargins({ left, right });

      // Height scales with width; increase factor and clamp for a taller chart
      const h = Math.max(360, Math.min(820, Math.round(w * 0.62)));
      setChartHeight(h);
    };

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect?.width || el.clientWidth || 960;
        computeFromWidth(w);
      }
    });
    ro.observe(el);
    // Initial compute
    computeFromWidth(el.clientWidth || 960);
    return () => ro.disconnect();
  }, []);

// Minimal API proxy helper (BallDontLie - still used for player stats only)
  const apiGet = useCallback(async (endpoint: string, params: Record<string, any>) => {
    const url = new URL("/api/balldontlie", window.location.origin);
    url.searchParams.set("endpoint", endpoint);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else if (v != null) {
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }, []);

  // ===== Legacy strict BDL player ID lookup (copied from page.legacy.tsx) =====
  const playerIdCache = useRef<Map<string, number>>(new Map());
  const failedLookupCache = useRef<Set<string>>(new Set());
  const rateLimitDelay = (attempt: number) => {
    const delays = [0, 1000, 2000, 5000, 10000];
    return delays[Math.min(attempt, delays.length - 1)];
  };
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const fetchWithRetry = useCallback(async (url: string, maxRetries = 3): Promise<any> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(rateLimitDelay(attempt));
        }
        const response = await fetch(url, { cache: 'no-store' });
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : rateLimitDelay(attempt + 1);
          await sleep(waitTime);
          continue;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        if (attempt === maxRetries) throw error;
      }
    }
  }, []);

  const fetchBDLPlayerIdByName = useCallback(async (name: string): Promise<number | null> => {
    if (playerIdCache.current.has(name)) return playerIdCache.current.get(name)!;
    if (failedLookupCache.current.has(name)) return null;
    try {
      // Step 1: exact full name search
      let url = `/api/balldontlie?endpoint=/players&search=${encodeURIComponent(name)}&per_page=100`;
      let data = await fetchWithRetry(url);
      let players: any[] = Array.isArray(data?.data) ? data.data : [];
      const targetLower = name.toLowerCase().trim();
      const exactMatch = players.find(p => `${p.first_name} ${p.last_name}`.toLowerCase().trim() === targetLower);
      if (exactMatch) {
        const verifyUrl = `/api/balldontlie?endpoint=/players&player_ids[]=${exactMatch.id}`;
        const verifyData = await fetchWithRetry(verifyUrl);
        const verifyPlayer = verifyData?.data?.[0];
        if (verifyPlayer && `${verifyPlayer.first_name} ${verifyPlayer.last_name}`.toLowerCase().trim() === targetLower) {
          playerIdCache.current.set(name, exactMatch.id);
          return exactMatch.id;
        }
      }
      // Step 2: try last name search and precise first+last match
      const parts = name.split(' ');
      if (parts.length >= 2) {
        const lastName = parts[parts.length - 1];
        const firstName = parts[0];
        url = `/api/balldontlie?endpoint=/players&search=${encodeURIComponent(lastName)}&per_page=100`;
        data = await fetchWithRetry(url);
        players = Array.isArray(data?.data) ? data.data : [];
        const precise = players.find(p => p.first_name.toLowerCase().trim() === firstName.toLowerCase().trim() && p.last_name.toLowerCase().trim() === lastName.toLowerCase().trim());
        if (precise) {
          const verifyUrl2 = `/api/balldontlie?endpoint=/players&player_ids[]=${precise.id}`;
          const verifyData2 = await fetchWithRetry(verifyUrl2);
          const verifyPlayer2 = verifyData2?.data?.[0];
          if (verifyPlayer2 && verifyPlayer2.first_name.toLowerCase().trim() === firstName.toLowerCase().trim() && verifyPlayer2.last_name.toLowerCase().trim() === lastName.toLowerCase().trim()) {
            playerIdCache.current.set(name, precise.id);
            return precise.id;
          }
        }
      }
      failedLookupCache.current.add(name);
      return null;
    } catch {
      failedLookupCache.current.add(name);
      return null;
    }
  }, [fetchWithRetry]);

  // Find playerId by name (best-effort scoring)
  const fetchPlayerIdByName = useCallback(async (name: string, teamAbbr?: string | null): Promise<number | null> => {
    const raw = (name || '').trim();
    if (raw.length < 2) return null;

    // Normalize helper: remove diacritics, punctuation, extra spaces
    const norm = (s: string) => s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Remove common suffixes from the query (jr, sr, ii, iii, iv)
    const stripSuffix = (s: string) => s
      .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Team abbr normalization mapping
    const normTeam = (abbr?: string | null) => {
      const up = String(abbr || '').toUpperCase();
      const map: Record<string, string> = { BRK: 'BKN', NOR: 'NOP', NOH: 'NOP', NJN: 'BKN', PHO: 'PHX', SAN: 'SAS', UTH: 'UTA', NY: 'NYK', CHH: 'CHA', SEA: 'OKC' };
      return map[up] || up;
    };

    const q = norm(stripSuffix(raw));
    const qTokens = q.split(' ').filter(Boolean);

    try {
      const data = await apiGet("/players", { search: raw, per_page: 100 });
      const list: any[] = Array.isArray(data?.data) ? data.data : [];
      if (list.length === 0) return null;

      const desiredTeam = normTeam(teamAbbr);
      let best: { id: number; score: number } | null = null;

      for (const p of list) {
        const fn = norm(String(p.first_name || ''));
        const ln = norm(String(p.last_name || ''));
        const full = `${fn} ${ln}`.trim();
        const candTokens = full.split(' ').filter(Boolean);

        // Token overlap score
        let overlap = 0;
        for (const t of qTokens) {
          if (candTokens.includes(t)) overlap += 1;
        }
        const tokenScore = overlap * 25; // each matching token is strong

        // Starts-with bonus
        const startsScore = full.startsWith(q) ? 30 : 0;

        // Exact full match bonus
        const exactScore = full === q ? 50 : 0;

        // Partial include bonus
        const includeScore = full.includes(q) ? 10 : 0;

        // Team match bonus
        const candTeam = normTeam(p?.team?.abbreviation);
        const teamBonus = desiredTeam && candTeam && desiredTeam === candTeam ? 40 : 0;

        const score = tokenScore + startsScore + exactScore + includeScore + teamBonus;
        if (!best || score > best.score) best = { id: p.id, score };
      }

      // If score threshold not met, try last-name focused fallback
      if (!best || best.score < 25) {
        try {
          const parts = qTokens;
          const last = parts[parts.length - 1] || '';
          if (last) {
            const res2 = await apiGet("/players", { search: last, per_page: 100 });
            const list2: any[] = Array.isArray(res2?.data) ? res2.data : [];
            let altBest: { id: number; score: number } | null = null;
            for (const p of list2) {
              const fn = norm(String(p.first_name || ''));
              const ln = norm(String(p.last_name || ''));
              const full = `${fn} ${ln}`.trim();
              const exact = full === q ? 60 : 0;
              const starts = full.startsWith(q) ? 30 : 0;
              let overlap = 0;
              const candTokens = full.split(' ').filter(Boolean);
              for (const t of qTokens) if (candTokens.includes(t)) overlap += 1;
              const tok = overlap * 20;
              const candTeam = normTeam(p?.team?.abbreviation);
              const teamB = desiredTeam && candTeam && desiredTeam === candTeam ? 40 : 0;
              const sc = exact + starts + tok + teamB;
              if (!altBest || sc > altBest.score) altBest = { id: p.id, score: sc };
            }
            if (altBest && altBest.score >= 25) return altBest.id;
          }
        } catch {}
        return null;
      }
      return best.id;
    } catch {
      return null;
    }
  }, [apiGet]);

  // Helpers for derived metrics when advanced endpoints are unavailable
  const calculateTrueShootingPercentage = (stats: any): number => {
    const pts = stats.pts || 0;
    const fga = stats.fga || 0;
    const fta = stats.fta || 0;
    if (fga === 0 && fta === 0) return 0;
    const tsAtt = 2 * (fga + 0.44 * fta);
    return tsAtt > 0 ? pts / tsAtt : 0;
  };
  const calculateEffectiveFGPercentage = (stats: any): number => {
    const fgm = stats.fgm || 0;
    const fga = stats.fga || 0;
    const fg3m = stats.fg3m || 0;
    if (fga === 0) return 0;
    return (fgm + 0.5 * fg3m) / fga;
  };

  // Normalize advanced response from BallDontLie to our fields, with guards
  const pct = (v: any): number | undefined => {
    if (v == null || isNaN(Number(v))) return undefined;
    const n = Number(v);
    if (n < 0) return undefined;
    // If value looks like 58 => 58%, convert to 0.58; if <=1.5, assume already fraction
    return n > 1.5 ? n / 100 : n;
  };
  const rtg = (v: any): number | undefined => {
    if (v == null || isNaN(Number(v))) return undefined;
    const n = Number(v);
    // Plausible NBA rating bounds
    if (n < 50 || n > 150) return undefined;
    return n;
  };
  const normalizeAdvancedFromBDL = (row: any): AdvancedStats => {
    const out: AdvancedStats = {};
    if (!row || typeof row !== 'object') return out;
    // Common field aliases used by BDL Advanced endpoints
    const aliases: Record<string, any> = {
      usage_percentage: row.usage_percentage ?? row.usg_pct,
      pace: row.pace,
      true_shooting_percentage: row.true_shooting_percentage ?? row.ts_pct,
      effective_field_goal_percentage: row.effective_field_goal_percentage ?? row.efg_pct,
      offensive_rating: row.offensive_rating ?? row.off_rtg,
      defensive_rating: row.defensive_rating ?? row.def_rtg,
      assist_percentage: row.assist_percentage ?? row.ast_pct,
      assist_to_turnover_ratio: row.assist_to_turnover_ratio ?? row.ast_to ?? row.ast_tov,
      turnover_ratio: row.turnover_ratio ?? row.tov_ratio,
      rebound_percentage: row.rebound_percentage ?? row.trb_pct,
      defensive_rebound_percentage: row.defensive_rebound_percentage ?? row.drb_pct,
      net_rating: row.net_rating ?? ( (row.offensive_rating ?? row.off_rtg) - (row.defensive_rating ?? row.def_rtg) ),
      player_efficiency_rating: row.pie ?? row.player_efficiency_rating,
    };
    out.usage_percentage = pct(aliases.usage_percentage);
    out.pace = typeof aliases.pace === 'number' ? aliases.pace : undefined;
    out.true_shooting_percentage = pct(aliases.true_shooting_percentage);
    out.effective_field_goal_percentage = pct(aliases.effective_field_goal_percentage);
    out.offensive_rating = rtg(aliases.offensive_rating);
    out.defensive_rating = rtg(aliases.defensive_rating);
    out.assist_percentage = pct(aliases.assist_percentage);
    out.assist_to_turnover_ratio = typeof aliases.assist_to_turnover_ratio === 'number' ? aliases.assist_to_turnover_ratio : undefined;
    out.turnover_ratio = pct(aliases.turnover_ratio);
    out.rebound_percentage = pct(aliases.rebound_percentage);
    out.defensive_rebound_percentage = pct(aliases.defensive_rebound_percentage);
    const net = typeof aliases.net_rating === 'number' ? aliases.net_rating : undefined;
    out.net_rating = typeof net === 'number' && net > -80 && net < 80 ? net : undefined;
    out.player_efficiency_rating = typeof aliases.player_efficiency_rating === 'number' ? aliases.player_efficiency_rating : undefined;
    return out;
  };





  const formatYMD = (d: Date) => d.toISOString().split("T")[0];

  // ESPN team logos (live) - fetch once and cache in window
  const [espnLogoMap, setEspnLogoMap] = useState<Record<string, string>>({});
  // Use centralized abbreviation normalization
  const normalizeAbbr = (abbr?: string | null) => {
    return normalizeTeamAbbr(abbr);
  };
  const pickEspnLogo = (logos: any[]): string | null => {
    if (!Array.isArray(logos) || logos.length === 0) return null;
    // Prefer scoreboard, then default, then first
    const scoreboard = logos.find((l: any) => Array.isArray(l?.rel) && l.rel.includes('scoreboard'))?.href;
    const def = logos.find((l: any) => Array.isArray(l?.rel) && (l.rel.includes('default') || l.rel.length === 0))?.href;
    return (scoreboard || def || logos[0]?.href) || null;
  };
  useEffect(() => {
    (async () => {
      try {
        const win: any = typeof window !== 'undefined' ? window : undefined;
        if (win && win.__espnLogoMap) { setEspnLogoMap(win.__espnLogoMap); return; }
        const u = new URL('/api/espn-nba', window.location.origin);
        u.searchParams.set('action', 'teams');
        const resp = await fetch(u.toString(), { cache: 'force-cache' });
        if (!resp.ok) return;
        const js = await resp.json();
        const teams: any[] = Array.isArray(js?.data) ? js.data : [];
        const map: Record<string, string> = {};
        for (const t of teams) {
          const abbr = normalizeAbbr(t?.abbreviation);
          const href = pickEspnLogo(t?.logos || []);
          if (abbr && href) map[abbr] = href;
        }
        setEspnLogoMap(map);
        if (win) win.__espnLogoMap = map;
      } catch {}
    })();
  }, []);
  const getTeamLogoUrl = (abbr?: string | null): string | null => {
    const k = normalizeAbbr(abbr);
    return espnLogoMap[k] || null;
  };

  // Map 3-letter abbr to full team name for odds matching
  const abbrToFullName = (abbr?: string | null): string | undefined => {
    const map: Record<string, string> = {
      ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls',
      CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons', GSW: 'Golden State Warriors',
      HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers', LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies',
      MIA: 'Miami Heat', MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks',
      OKC: 'Oklahoma City Thunder', ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers',
      SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards'
    };
    const k = normalizeAbbr(abbr);
    return map[k];
  };

  // ---------- Lightweight client cache for search and stats checks ----------
  const SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const statsHasCacheRef = useRef<Map<string, boolean>>(new Map());

  // Preloaded full suggestion list (active roster -> BDL IDs); filtered locally on input
  const [allSuggestions, setAllSuggestions] = useState<NameSuggestion[]>([]);
  const allSuggRef = useRef<NameSuggestion[]>([]);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  // Preload server-side cached suggestions (BDL-aligned) to avoid per-keystroke API calls

  const handleSearchChange = useCallback((v: string) => {
    setSearchName(v);
    const q = (v || '').trim();
    if (!q || q.length < 2) {
      setNameSuggestions([]);
      setShowNameSuggestions(false);
      return;
    }
    // Legacy: compute matches from ESPN roster directly
    const names = getPlayerMatchesLegacy(q);
    const suggestions: NameSuggestion[] = names.map(full => ({
      id: "", // resolved on selection via legacy lookup
      full,
      teamAbbr: getPlayerTeamLegacy(full)
    }));
    setNameSuggestions(suggestions);
    setHighlightIndex(suggestions.length ? 0 : -1);
    setShowNameSuggestions(suggestions.length > 0);
  }, [getPlayerMatchesLegacy, getPlayerTeamLegacy]);

  const handleSelectSuggestion = useCallback((s: NameSuggestion) => {
    // Clear previous player data immediately to avoid stale display
    setAdv(null);
    setClutch(null);
    setSeasonAverages(null);
    setChartData([]);
    setGameRows([]);
    setErrorMsg(null);

    // Apply new selection
    setDisplayName(s.full);
    setSelectedTeamAbbr(s.teamAbbr);
    setSearchName(s.full);

    // Reset playerId; if suggestion carried an id, set it; otherwise it will be resolved by lookup effect
    setPlayerId(null);
    if (s.id) {
      const maybeId = s.id.startsWith('bdl:') ? Number(s.id.split(':')[1]) : Number(s.id);
      if (!Number.isNaN(maybeId) && maybeId > 0) setPlayerId(maybeId);
    }

    // Close suggestions and force a fresh fetch for this player
    setShowNameSuggestions(false);
    setNameSuggestions([]);
    setHighlightIndex(-1);

    // Set default prop line to N/A for all props until Odds API integration is ready
    setPropLine(0.5);
    setVaLine(0.5);

    setRefreshKey(k => k + 1);
  }, []);

  // Close suggestions on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const box = searchBoxRef.current;
      if (box && !box.contains(e.target as Node)) {
        setShowNameSuggestions(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);
  const readCache = (key: string): any | null => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      if (obj.ts && Date.now() - obj.ts > (obj.ttl ?? SEARCH_TTL_MS)) return null;
      return obj.v;
    } catch { return null; }
  };
  const writeCache = (key: string, v: any, ttl = SEARCH_TTL_MS) => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(key, JSON.stringify({ v, ts: Date.now(), ttl }));
    } catch {}
  };
  const SEARCH_CACHE_VERSION = 'server-v2';
  const getSearchCacheKey = (q: string, seasonYear: number) => `search:${SEARCH_CACHE_VERSION}:${seasonYear}:${q.toLowerCase()}`;
  const getListCacheKey = (seasonYear: number) => `searchlist:${SEARCH_CACHE_VERSION}:${seasonYear}`;
  const getStatsCacheKey = (pid: number, seasonYear: number) => `statsHas:${seasonYear}:${pid}`;

  // Quick existence check: does this player have any stats rows for the given season?
  // Disabled during local-only search to avoid network calls while typing.
  const hasStatsQuick = useCallback(async (_pid: number, _seasonYear: number): Promise<boolean> => {
    return true;
  }, []);

  // Resolve a BallDontLie ID by exact name + team match
  const resolveBDLId = useCallback(async (name: string, teamAbbr?: string | null): Promise<number | null> => {
    try {
      // First, use preloaded lookup if available
      const win: any = typeof window !== 'undefined' ? window : undefined;
      const normName = (s: string) => s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/gi, '')
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const key = `${normName(name)}|${normalizeAbbr(teamAbbr || '')}`;
      if (win && win.__bdlLookup && typeof win.__bdlLookup[key] === 'number') {
        return Number(win.__bdlLookup[key]) || null;
      }
      const res = await apiGet('/players', { search: name, per_page: 100 });
      const list: any[] = Array.isArray(res?.data) ? res.data : [];
      const target = normName(name);
      const team = teamAbbr ? normalizeAbbr(teamAbbr) : null;
      for (const p of list) {
        const full = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        const fullNorm = normName(full);
        const candTeam = p?.team?.abbreviation ? normalizeAbbr(p.team.abbreviation) : null;
        if (fullNorm === target && (!team || candTeam === team)) return Number(p.id) || null;
      }
      // starts-with backup with team match
      for (const p of list) {
        const full = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        const fullNorm = normName(full);
        const candTeam = p?.team?.abbreviation ? normalizeAbbr(p.team.abbreviation) : null;
        if (fullNorm.startsWith(target) && (!team || candTeam === team)) return Number(p.id) || null;
      }
      // final fallback: first result id
      if (list.length > 0) return Number(list[0].id) || null;
      return null;
    } catch { return null; }
  }, [apiGet]);

  const formatHeightText = (feet: number | null, inches: number | null): string | null => {
    if (feet == null && inches == null) return null;
    const f = feet ?? 0;
    const i = inches ?? 0;
    return `${f}'${i}"`;
  };







  const minutesToSeconds = (min: any): number => {
    if (!min) return 0;
    if (typeof min === 'number') return Math.max(0, Math.round(min * 60));
    if (typeof min === 'string') {
      const parts = min.split(':');
      if (parts.length === 2) {
        const m = parseInt(parts[0], 10) || 0;
        const s = parseInt(parts[1], 10) || 0;
        return m * 60 + s;
      }
      const n = parseInt(min, 10);
      return isNaN(n) ? 0 : n * 60;
    }
    return 0;
  };





  // Compute dynamic sizes from viewport so barriers and center width change continuously
  useEffect(() => {
    const computeDynamic = () => {
      const vw = window.innerWidth || 1024;
      // Barriers: ~6% of viewport each, clamped
      const bw = Math.max(8, Math.min(220, Math.round(vw * 0.06)));
      setBarrierWidth(bw);

      // Center max width scales with viewport; make chart a bit narrower for a taller look
      const avail = Math.max(320, vw - bw * 2 - 48);
      const target = Math.round(Math.max(520, Math.min(1200, avail * 0.86)));
      setCenterMaxWidth(target);
    };
    computeDynamic();
    window.addEventListener("resize", computeDynamic, { passive: true } as any);
    return () => window.removeEventListener("resize", computeDynamic);
  }, []);

  // Helper: derive NBA season year from ISO date (Oct 1 starts new season)
  const seasonFromISO = (iso?: string | null): number | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-based
    // NBA season turns over in October (month 9)
    return m >= 9 ? y : y - 1;
  };

  // Scheduled auto-refresh at two daily times in America/New_York (e.g., ~after games end and backup)
  useEffect(() => {
    try {
      const timers: number[] = [];
      const ONE_DAY = 24 * 60 * 60 * 1000;

      const firstDelayMs = (hourET: number, minuteET: number) => {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).formatToParts(now);
        const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
        const y = get('year');
        const m = get('month');
        const d = get('day');
        const h = get('hour');
        const min = get('minute');
        const sec = get('second');
        let targetUTC = Date.UTC(y, m - 1, d, hourET, minuteET, 0);
        const nowUTC = Date.now();
        const nowETSeconds = h * 3600 + min * 60 + sec;
        const targetETSeconds = hourET * 3600 + minuteET * 60;
        if (nowETSeconds >= targetETSeconds) {
          const next = new Date(targetUTC);
          next.setUTCDate(next.getUTCDate() + 1);
          targetUTC = next.getTime();
        }
        const dly = Math.max(1000, Math.min(36 * 60 * 60 * 1000, targetUTC - nowUTC)); // at least 1s
        return dly;
      };

      const scheduleDaily = (hourET: number, minuteET: number) => {
        const delay = firstDelayMs(hourET, minuteET);
        const id = window.setTimeout(function tick() {
          setRefreshKey(k => k + 1);
          // Schedule exactly 24h later to avoid tight loops if computed delay hits 0
          const nextId = window.setTimeout(tick, ONE_DAY);
          timers.push(nextId);
        }, delay);
        timers.push(id);
      };

      scheduleDaily(1, 30); // ~1:30 AM ET
      scheduleDaily(5, 0);  // ~5:00 AM ET backup

      return () => {
        for (const id of timers) window.clearTimeout(id);
      };
    } catch {
      // ignore scheduling errors (e.g., SSR)
    }
  }, []);

  // Chart data is driven by fetched game logs
  const displayedChartData = useMemo(() => {
    console.log('📈 displayedChartData recalculating - gameRows.length:', gameRows.length, 'timeFilter:', timeFilter, 'chartMetric:', chartMetric);
    if (!Array.isArray(gameRows)) return [] as ChartPoint[];
    let rows = gameRows.slice();
    // Apply timeframe filters using normalized rows
    if (timeFilter === 'h2h') {
      const opp = opponentTeam ? normalizeAbbr(opponentTeam) : '';
      if (opp) rows = rows.filter((d: any) => normalizeAbbr(d?.opponent || '') === opp);
    } else if (timeFilter === 'thisSeason') {
      const now = new Date();
      const currentSeasonYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
      rows = rows.filter((d: any) => seasonFromISO(d?.fullDate) === currentSeasonYear);
    } else if (timeFilter === 'lastSeason') {
      const targetSeason = season - 1;
      const filtered = rows.filter((d: any) => seasonFromISO(d?.fullDate) === targetSeason);
      rows = filtered.length ? filtered : rows;
    } else {
      // last5/10/20 use slicing at end
      if (timeFilter === 'last5') rows = rows.slice(-5);
      if (timeFilter === 'last10') rows = rows.slice(-10);
      if (timeFilter === 'last20') rows = rows.slice(-20);
    }
    // Map to chart points using current metric
    const pick = (r: any): number => {
      switch (chartMetric) {
        case 'reb': return r.reb ?? 0;
        case 'ast': return r.ast ?? 0;
        case 'fg3m': return r.fg3m ?? 0;
        case 'fg3a': return r.fg3a ?? 0;
        case 'pra': return (r.pts ?? 0) + (r.reb ?? 0) + (r.ast ?? 0);
        case 'pr': return (r.pts ?? 0) + (r.reb ?? 0);
        case 'pa': return (r.pts ?? 0) + (r.ast ?? 0);
        case 'ra': return (r.reb ?? 0) + (r.ast ?? 0);
        case 'fgm': return r.fgm ?? 0;
        case 'fga': return r.fga ?? 0;
        case 'ftm': return r.ftm ?? 0;
        case 'fta': return r.fta ?? 0;
        case 'stl': return r.stl ?? 0;
        case 'blk': return r.blk ?? 0;
        case 'oreb': return r.oreb ?? 0;
        case 'dreb': return r.dreb ?? 0;
        case 'pf': return r.pf ?? 0;
        case 'to': return r.to ?? 0;
        case 'min': {
          const m = r.minutes;
          if (typeof m === 'string') {
            if (m.includes(':')) { const [mm, ss] = m.split(':'); return (parseInt(mm)||0) + (parseInt(ss)||0)/60; }
            const f = parseFloat(m); return isNaN(f) ? 0 : f;
          }
          return typeof m === 'number' ? m : 0;
        }
        case 'fg_pct': return r.fg_pct != null ? Math.round((r.fg_pct as number) * 1000) / 10 : 0; // percent
        case 'fg3_pct': return r.fg3_pct != null ? Math.round((r.fg3_pct as number) * 1000) / 10 : 0;
        case 'ft_pct': return r.ft_pct != null ? Math.round((r.ft_pct as number) * 1000) / 10 : 0;
        case 'pts':
        default: return r.pts ?? 0;
      }
    };
    return rows.map((r: any) => ({ value: pick(r), dateLabel: r.dateLabel, opponent: r.opponent, fullDate: r.fullDate }));
  }, [gameRows, timeFilter, opponentTeam, season, chartMetric]);

  // Temporary bookmaker line behavior (Odds API not wired yet): keep existing line values
  useEffect(() => {
    // Keep existing line values until real data is available
    setVaLine(0.5);
    setPropLine(0.5);
  }, [selectedBookmaker, chartMetric, displayedChartData, displayName, playerId]);


  const chartValues = displayedChartData.map((d) => d.value);
  const gamesCount = chartValues.length;
  // Reserve some vertical room for the top controls inside the chart card
  const chartControlsOffset = 36; // px reserved for controls + spacing
  const chartInnerHeight = useMemo(() => Math.max(120, chartHeight - chartControlsOffset), [chartHeight]);
  
  // Memoize unit label to prevent recalculation
  const unitLabel = useMemo(() => {
    const map: Record<string, string> = {
      pts: 'PTS', reb: 'REB', ast: 'AST', pra: 'PRA', pr: 'PR', pa: 'PA', ra: 'RA',
      fg3m: '3PM', fg3a: '3PA', fgm: 'FGM', fga: 'FGA',
      ftm: 'FTM', fta: 'FTA', stl: 'STL', blk: 'BLK', oreb: 'OREB', dreb: 'DREB', pf: 'PF', to: 'TO', min: 'MIN',
      fg_pct: 'FG%', fg3_pct: '3P%', ft_pct: 'FT%'
    };
    return map[chartMetric] || 'VAL';
  }, [chartMetric]);
  
  
  const lastUpdatedText = useMemo(() => {
    if (!lastUpdated) return null;
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(lastUpdated);
    } catch {
      return lastUpdated.toLocaleString();
    }
  }, [lastUpdated]);
  // Memoize expensive calculations to prevent re-renders on propLine changes
  // Stats calculation moved to ChartStats component
  const statsCalculations = useMemo(() => {
    return {
      avgAll: 0,
      avgLast5: 0,
      maxVal: 0,
      minVal: 0,
      hitCount: 0,
      hitRate: 0
    };
  }, []);
  
  const { avgAll, avgLast5, maxVal, minVal, hitCount, hitRate } = statsCalculations;

  const leftLimit = 100; // px: left boundary target

  // Helper to resolve next opponent by team id (next scheduled regular season game)
  const nextSeasonFallbackStart = useCallback(() => {
    const now = new Date();
    const oct21ThisYear = new Date(now.getFullYear(), 9, 21); // Month is 0-indexed (9 = October)
    const start = now <= oct21ThisYear ? oct21ThisYear : new Date(now.getFullYear() + 1, 9, 21);
    return start;
  }, []);

  const resolveNextTeamMatch = useCallback(async (_teamId: number | null, teamAbbr?: string | null): Promise<TeamMatch | null> => {
    if (!teamAbbr) return null;
    try {
      // Opening night (approx) - can be adjusted via query later
      const opening = `${new Date().getFullYear()}-10-21`;
      // Cache games window on the client to avoid repeated hits
      const win: any = typeof window !== 'undefined' ? window : undefined;
      const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); // YYYY-MM-DD
      const cacheKey = `__espnGamesWindow:${etDate}`;
      let windowGames: any[] | null = null;
      if (win && win[cacheKey]) windowGames = win[cacheKey];
      if (!windowGames) {
        const u = new URL('/api/espn-nba', window.location.origin);
        u.searchParams.set('action', 'games-window');
        u.searchParams.set('opening', opening);
        u.searchParams.set('days', '2');
        const resp = await fetch(u.toString(), { cache: 'no-store' });
        if (resp.ok) {
          const js = await resp.json();
          windowGames = Array.isArray(js?.data) ? js.data : [];
          if (win) win[cacheKey] = windowGames;
        }
      }
      if (Array.isArray(windowGames) && windowGames.length) {
        const abbr = String(teamAbbr).toUpperCase();
        const candidates = windowGames.filter((g: any) => g.homeAbbr === abbr || g.visitorAbbr === abbr);
        candidates.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const n = candidates[0];
        if (n) {
          const opp = n.homeAbbr === abbr ? n.visitorAbbr : n.homeAbbr;
          return { oppAbbr: opp, dateISO: n.date, homeAbbr: n.homeAbbr, visitorAbbr: n.visitorAbbr, gameId: String(n.id || '') };
        }
      }
      // Fallback to schedule endpoint if window did not include the team's next game
      const now = new Date();
      const seasonYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
      const start = new Date(Math.max(Date.now(), new Date(seasonYear, 9, 1).getTime()));
      const startStr = formatYMD(start);
      const sched = new URL('/api/espn-nba', window.location.origin);
      sched.searchParams.set('action', 'schedule');
      sched.searchParams.set('season', String(seasonYear));
      sched.searchParams.set('startDate', startStr);
      sched.searchParams.set('teamAbbr', String(teamAbbr));
      const resp = await fetch(sched.toString(), { cache: 'no-store' });
      if (!resp.ok) return null;
      const js = await resp.json();
      const d = js?.data || null;
      if (d && d.oppAbbr && d.dateISO) {
        return {
          oppAbbr: String(d.oppAbbr).toUpperCase(),
          dateISO: String(d.dateISO),
          homeAbbr: String(d.homeAbbr || '').toUpperCase(),
          visitorAbbr: String(d.visitorAbbr || '').toUpperCase(),
          gameId: String(d.gameId || ''),
        };
      }
    } catch {}
    return null;
  }, []);

  // Fetch core player bio (height/position) from ESPN when name/team is known; fallback to BDL by ID
  useEffect(() => {
    (async () => {
      try {
        if (!displayName || !displayName.trim()) { setPlayerBio(null); return; }
        const nameQ = displayName.trim();
        // 1) Try ESPN all-rosters (cached server-side)
        try {
          const u = new URL('/api/espn-nba', window.location.origin);
          u.searchParams.set('action', 'all-rosters');
          const resp = await fetch(u.toString(), { cache: 'force-cache' });
          if (resp.ok) {
            const js = await resp.json();
            const all: Record<string, any[]> = js?.data || {};
            const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
            const q = norm(nameQ);
            const teamKey = selectedTeamAbbr ? normalizeAbbr(selectedTeamAbbr) : undefined;
            const searchTeams = teamKey && all[teamKey] ? { [teamKey]: all[teamKey] } : all;
            let found: any | null = null;
            for (const [abbr, players] of Object.entries(searchTeams)) {
              for (const p of (players as any[])) {
                const nm = norm(String(p?.displayName || p?.fullName || ''));
                if (nm === q || nm.includes(q) || q.includes(nm)) { found = p; break; }
              }
              if (found) break;
            }
            if (found) {
              const display = String(found.displayName || found.fullName || nameQ).trim();
              const dh = String(found.displayHeight || '');
              const m = dh.match(/(\d+)'\s*(\d+)?/);
              const hf = m ? parseInt(m[1], 10) : null;
              const hi = m ? (parseInt(m[2] || '0', 10)) : null;
              const pos = found?.position?.abbreviation || found?.position?.displayName || null;
              setPlayerBio({ name: display, heightFeet: isNaN(hf as any) ? null : hf, heightInches: isNaN(hi as any) ? null : hi, position: pos });
              return;
            }
          }
        } catch {}
        // 1.5) Local override for known missing heights
        const ov = PLAYER_HEIGHT_OVERRIDES[nameQ];
        if (ov) {
          setPlayerBio({ name: nameQ, heightFeet: ov.feet, heightInches: ov.inches, position: ov.position ?? null });
          return;
        }
        // 2) Fallback to BDL by ID if ESPN match not found
        if (playerId != null) {
          try {
            const p = await apiGet(`/players/${playerId}`, {} as any);
            const row = p?.data ?? p;
            const name = `${row?.first_name || ''} ${row?.last_name || ''}`.trim();
            const hf = row?.height_feet ?? null;
            const hi = row?.height_inches ?? null;
            const pos = row?.position ?? null;
            setPlayerBio({ name, heightFeet: hf, heightInches: hi, position: pos });
            return;
          } catch {}
        }
        setPlayerBio(null);
      } catch {
        setPlayerBio(null);
      }
    })();
  }, [displayName, selectedTeamAbbr, playerId, apiGet]);

  // When a name is selected, resolve playerId and fetch minimal stats (season averages + game logs)
  useEffect(() => {
    (async () => {
      if (!displayName || !displayName.trim()) {
        if (playerId !== null) setPlayerId(null);
        setAdv(null);
        setClutch(null);
        setSeasonAverages(null);
        setChartData([]);
        setGameRows([]);
        return;
      }
      try {
        console.log('[Dashboard] fetch start', { displayName, playerId, season, selectedTeamAbbr });
        setLoadingAdv(true);
        setLoadingClutch(true);
        // Resolve player id using legacy strict lookup first, then team-aware exact, then best-effort search
        let pid = playerId;
        if (pid == null || pid <= 0) {
          pid = await fetchBDLPlayerIdByName(displayName);
          if (pid == null) {
            const strictTeam = await resolveBDLId(displayName, selectedTeamAbbr);
            pid = strictTeam != null ? strictTeam : await fetchPlayerIdByName(displayName, selectedTeamAbbr);
          }
        }
        console.log('[Dashboard] resolved playerId', pid);
        setPlayerId(pid);
        if (!pid || pid <= 0) {
          setAdv(null);
          setClutch(null);
          setSeasonAverages(null);
          setChartData([]);
          setGameRows([]);
          setPlayerTeam("");
          setPlayerTeamId(null);
          setOpponentTeam("");
          return;
        }
        // Reset team/opponent while resolving to avoid stale carry-over
        setPlayerTeam("");
        setPlayerTeamId(null);
        setOpponentTeam("");
        // Resolve team/opponent via ESPN using the selected team abbreviation
        try {
          const abbr = selectedTeamAbbr ? normalizeAbbr(selectedTeamAbbr) : "";
          setPlayerTeam(abbr);
          setPlayerTeamId(null);

          if (abbr) {
            const match = await resolveNextTeamMatch(null, abbr);
            if (match) {
              setOpponentTeam(normalizeAbbr(match.oppAbbr));
              setNextMatch(match);
            } else {
              setOpponentTeam("");
              setNextMatch(null);
            }
            // Fetch depth chart for the player's team
            fetchRealDepthChart(abbr);
            // Fetch team roster for jersey numbers
            fetchTeamRoster(abbr);
          } else {
            setOpponentTeam("");
            setNextMatch(null);
            setRealDepthChart(null); // Clear depth chart if no team
            setTeamRoster([]); // Clear roster if no team
          }
        } catch {
          setPlayerTeam("");
          setPlayerTeamId(null);
          setOpponentTeam("");
          setNextMatch(null);
        }
        // Fetch general advanced stats first (GOAT plan)
        let advRow: any = null;
        try {
          const advMain = await apiGet('/stats/advanced', { "player_ids[]": [pid], "seasons[]": [season] });
          advRow = Array.isArray(advMain?.data) ? advMain.data[0] : null;
        } catch {}

        // Fetch season averages and compute basic advanced metrics
        let saRow: any = null;
        try {
          const sa1 = await apiGet("/season_averages", { season, player_id: pid });
          saRow = Array.isArray(sa1?.data) ? sa1.data[0] : null;
        } catch {}

        // Merge into AdvancedStats state with strict BDL normalization and guards
        if (advRow || saRow) {
          let merged: AdvancedStats = {};
          if (advRow) {
            merged = { ...normalizeAdvancedFromBDL(advRow) };
          }
          // Fill derivable metrics and compute missing pieces from season averages if present
          if (saRow) {
            // Snapshot season averages for quick top-right display
            setSeasonAverages({
              pts: typeof saRow.pts === 'number' ? saRow.pts : null,
              reb: typeof saRow.reb === 'number' ? saRow.reb : null,
              ast: typeof saRow.ast === 'number' ? saRow.ast : null,
              fg3m: typeof saRow.fg3m === 'number' ? saRow.fg3m : null,
              fg3_pct: typeof saRow.fg3_pct === 'number' ? (saRow.fg3_pct > 1.5 ? saRow.fg3_pct / 100 : saRow.fg3_pct) : (typeof saRow.fg3m === 'number' && typeof saRow.fg3a === 'number' && saRow.fg3a > 0 ? saRow.fg3m / saRow.fg3a : null),
            });
            if (merged.true_shooting_percentage == null) {
              merged.true_shooting_percentage = calculateTrueShootingPercentage(saRow);
            }
            if (merged.effective_field_goal_percentage == null) {
              merged.effective_field_goal_percentage = calculateEffectiveFGPercentage(saRow);
            }
            if (merged.assist_to_turnover_ratio == null) {
              const ast = Number(saRow.ast ?? 0);
              const tov = Number(saRow.turnover ?? saRow.turnovers ?? 0);
              merged.assist_to_turnover_ratio = tov === 0 ? (ast > 0 ? 999 : 0) : ast / tov;
            }
          } else {
            setSeasonAverages(null);
          }
          // If ratings are implausible after normalization, drop them to avoid fake stats
          if (typeof merged.offensive_rating === 'number' && (merged.offensive_rating < 50 || merged.offensive_rating > 150)) merged.offensive_rating = undefined;
          if (typeof merged.defensive_rating === 'number' && (merged.defensive_rating < 50 || merged.defensive_rating > 150)) merged.defensive_rating = undefined;
          if (typeof merged.net_rating === 'number' && (merged.net_rating < -80 || merged.net_rating > 80)) merged.net_rating = undefined;

          setAdv(Object.keys(merged).length ? merged : null);
        } else {
          setAdv(null);
          setSeasonAverages(null);
        }

        // Try clutch advanced endpoint (if available)
        try {
          const adv = await apiGet('/stats/advanced', { "player_ids[]": [pid], "seasons[]": [season], category: 'clutch' });
          const crow = Array.isArray(adv?.data) ? adv.data[0] : null;
          if (crow) {
            setClutch({
              clutch_usage: crow.usage_percentage,
              clutch_ts: crow.true_shooting_percentage,
              clutch_ppg: crow.pts,
            });
          } else {
            setClutch(null);
          }
        } catch {
          setClutch(null);
        }
        // Fetch game logs for chart (regular+post)
        const combineForSeason = async (seasonYear: number, postseason: boolean) => {
          let page = 1; const all: any[] = [];
          while (true) {
            const res = await apiGet('/stats', { "player_ids[]": [pid], "seasons[]": [seasonYear], per_page: 100, postseason, page });
            const rows: any[] = Array.isArray(res?.data) ? res.data : [];
            if (rows.length === 0) break;
            all.push(...rows);
            const next = res?.meta?.next_page ?? null;
            if (!next) break; page = next; if (page > 50) break;
          }
          return all;
        };
        const now = new Date();
        const currentSeasonYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
        const lastSeasonYear = currentSeasonYear - 1;
        const [regLast, postLast, regThis, postThis] = await Promise.all([
          combineForSeason(lastSeasonYear, false),
          combineForSeason(lastSeasonYear, true),
          combineForSeason(currentSeasonYear, false),
          combineForSeason(currentSeasonYear, true),
        ]);
        const combinedLast = [...regLast, ...postLast];
        const combinedThis = [...regThis, ...postThis];
        const allCombined = [...combinedLast, ...combinedThis];
        let played = allCombined.filter(r => minutesToSeconds(r?.min) > 0);
        played.sort((a, b) => new Date(a.game?.date || 0).getTime() - new Date(b.game?.date || 0).getTime());
        const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
        // Normalize rows for flexible metric display
        const normalized = played.map(r => {
          const iso = r.game?.date ? String(r.game.date) : '';
          const d = iso ? new Date(iso) : null;
          const label = d ? formatter.format(d) : '';
          const home = r?.game?.home_team?.abbreviation ? String(r.game.home_team.abbreviation).toUpperCase() : undefined;
          const away = r?.game?.visitor_team?.abbreviation ? String(r.game.visitor_team.abbreviation).toUpperCase() : undefined;
          const teamAbbr = r?.team?.abbreviation ? String(r.team.abbreviation).toUpperCase() : undefined;
          const opponent = teamAbbr && home && away ? (teamAbbr === home ? away : teamAbbr === away ? home : undefined) : undefined;
          return {
            fullDate: iso,
            dateLabel: label,
            opponent,
            minutes: r?.min,
            pts: typeof r.pts === 'number' ? r.pts : undefined,
            reb: typeof r.reb === 'number' ? r.reb : undefined,
            ast: typeof r.ast === 'number' ? r.ast : undefined,
            fg3m: typeof r.fg3m === 'number' ? r.fg3m : undefined,
            fg3a: typeof r.fg3a === 'number' ? r.fg3a : undefined,
            fgm: typeof r.fgm === 'number' ? r.fgm : undefined,
            fga: typeof r.fga === 'number' ? r.fga : undefined,
            ftm: typeof r.ftm === 'number' ? r.ftm : undefined,
            fta: typeof r.fta === 'number' ? r.fta : undefined,
            stl: typeof r.stl === 'number' ? r.stl : undefined,
            blk: typeof r.blk === 'number' ? r.blk : undefined,
            oreb: typeof r.oreb === 'number' ? r.oreb : undefined,
            dreb: typeof r.dreb === 'number' ? r.dreb : undefined,
            pf: typeof r.pf === 'number' ? r.pf : undefined,
            to: typeof (r.turnover ?? r.turnovers) === 'number' ? (r.turnover ?? r.turnovers) : undefined,
            fg_pct: typeof r.fg_pct === 'number' ? r.fg_pct : undefined,
            fg3_pct: typeof r.fg3_pct === 'number' ? r.fg3_pct : undefined,
            ft_pct: typeof r.ft_pct === 'number' ? r.ft_pct : undefined,
          };
        });
        // Default chartData remains points for compatibility
        let data: ChartPoint[] = normalized.map(n => ({ value: n.pts ?? 0, dateLabel: n.dateLabel, fullDate: n.fullDate, opponent: n.opponent }));
        setGameRows(normalized);
        
        // If no data at all, try analysis endpoint recentGames as fallback
        if (data.length === 0) {
          try {
            const resp = await fetch(`/api/nba-balldontlie?action=player_analysis&player_id=${pid}`);
            if (resp.ok) {
              const analysis = await resp.json();
              const games: any[] = (analysis?.data?.recentGames || []);
              const normalized = games.slice().reverse().map((g: any) => {
                const iso = g.game?.date ? String(g.game.date) : '';
                const d = iso ? new Date(iso) : null;
                const label = d ? formatter.format(d) : '';
                const home = g?.game?.home_team?.abbreviation ? String(g.game.home_team.abbreviation).toUpperCase() : undefined;
                const away = g?.game?.visitor_team?.abbreviation ? String(g.game.visitor_team.abbreviation).toUpperCase() : undefined;
                const teamAbbr = g?.team?.abbreviation ? String(g.team.abbreviation).toUpperCase() : undefined;
                const opponent = teamAbbr && home && away ? (teamAbbr === home ? away : teamAbbr === away ? home : undefined) : undefined;
                return {
                  fullDate: iso,
                  dateLabel: label,
                  opponent,
                  minutes: g?.min,
                  pts: typeof g.pts === 'number' ? g.pts : undefined,
                  reb: typeof g.reb === 'number' ? g.reb : undefined,
                  ast: typeof g.ast === 'number' ? g.ast : undefined,
                  fg3m: typeof g.fg3m === 'number' ? g.fg3m : undefined,
                  fg3a: typeof g.fg3a === 'number' ? g.fg3a : undefined,
                  fgm: typeof g.fgm === 'number' ? g.fgm : undefined,
                  fga: typeof g.fga === 'number' ? g.fga : undefined,
                  ftm: typeof g.ftm === 'number' ? g.ftm : undefined,
                  fta: typeof g.fta === 'number' ? g.fta : undefined,
                  stl: typeof g.stl === 'number' ? g.stl : undefined,
                  blk: typeof g.blk === 'number' ? g.blk : undefined,
                  oreb: typeof g.oreb === 'number' ? g.oreb : undefined,
                  dreb: typeof g.dreb === 'number' ? g.dreb : undefined,
                  pf: typeof g.pf === 'number' ? g.pf : undefined,
                  to: typeof (g.turnover ?? g.turnovers) === 'number' ? (g.turnover ?? g.turnovers) : undefined,
                  fg_pct: typeof g.fg_pct === 'number' ? g.fg_pct : undefined,
                  fg3_pct: typeof g.fg3_pct === 'number' ? g.fg3_pct : undefined,
                  ft_pct: typeof g.ft_pct === 'number' ? g.ft_pct : undefined,
                };
              });
              setGameRows(normalized);
              data = normalized.map(n => ({ value: n.pts ?? 0, dateLabel: n.dateLabel, fullDate: n.fullDate, opponent: n.opponent }));
            }
          } catch {}
        }
        setChartData(data);
        setLastUpdated(new Date());
      } catch (e) {
        setErrorMsg(String((e as any)?.message ?? e));
        setAdv(null);
        setClutch(null);
        setChartData([]);
      } finally {
        setLoadingAdv(false);
        setLoadingClutch(false);
      }
    })();
  }, [displayName, playerId, season, fetchPlayerIdByName, apiGet, selectedTeamAbbr, refreshKey, fetchRealDepthChart, fetchTeamRoster]);

  return (
    <>
      {/* Professional custom scrollbar styles - hidden by default, visible on hover */}
      <style jsx global>{`
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: transparent transparent;
          transition: scrollbar-color 0.8s ease 0.5s;
        }
        .custom-scrollbar:hover {
          scrollbar-color: ${themeDark ? '#4b5563' : '#d1d5db'} transparent;
          transition: scrollbar-color 0.2s ease 0s;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
          background: transparent;
          -webkit-appearance: none !important;
          appearance: none !important;
        }
        .custom-scrollbar::-webkit-scrollbar:no-button {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar:vertical {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar:horizontal {
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 3px;
          transition: background 0.8s ease 0.5s;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-track {
          background: ${themeDark ? 'rgba(31, 41, 55, 0.2)' : 'rgba(226, 232, 240, 0.3)'};
          transition: background 0.2s ease 0s;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: transparent;
          border-radius: 3px;
          transition: background 0.8s ease 0.5s;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb {
          background: ${themeDark ? '#4b5563' : '#d1d5db'};
          transition: background 0.2s ease 0s;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${themeDark ? '#6b7280' : '#9ca3af'} !important;
        }
        .custom-scrollbar::-webkit-scrollbar-corner {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-button {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          background: transparent !important;
          appearance: none !important;
          -webkit-appearance: none !important;
          border: none !important;
          outline: none !important;
        }
        .custom-scrollbar::-webkit-scrollbar-button:single-button {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        .custom-scrollbar::-webkit-scrollbar-button:double-button {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        .custom-scrollbar::-webkit-scrollbar-button:start:decrement,
        .custom-scrollbar::-webkit-scrollbar-button:end:increment {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          background: transparent !important;
        }
        .custom-scrollbar::-webkit-scrollbar-button:horizontal:start:decrement,
        .custom-scrollbar::-webkit-scrollbar-button:horizontal:end:increment,
        .custom-scrollbar::-webkit-scrollbar-button:vertical:start:decrement,
        .custom-scrollbar::-webkit-scrollbar-button:vertical:end:increment {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          background: transparent !important;
          appearance: none !important;
        }
        /* Additional attempt to hide any remaining arrow buttons */
        .custom-scrollbar::-webkit-scrollbar-button:increment,
        .custom-scrollbar::-webkit-scrollbar-button:decrement {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        /* Force hide all possible button states */
        .custom-scrollbar::-webkit-scrollbar-button * {
          display: none !important;
        }
        .custom-scrollbar::-webkit-scrollbar-button::before,
        .custom-scrollbar::-webkit-scrollbar-button::after {
          display: none !important;
          content: none !important;
        }
      `}</style>
      <div className={`min-h-screen relative ${themeDark ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}>
      {/* Foreground content */}
      <div className="relative z-10 max-w-[1400px] mx-auto py-4" style={{ paddingLeft: `${leftLimit}px`, paddingRight: `${leftLimit}px` }}>
        {/* Top container with centered search */}
        <div
          className={`rounded-xl shadow-sm ${themeDark ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200"} flex items-center justify-center`}
          style={{ position: "relative", zIndex: 10, height: `120px`, marginLeft: `-${leftLimit}px`, marginRight: `-${leftLimit}px` }}
        >
          {/* Preload server-side cached suggestion index (BDL-aligned, shared across users) */}
          <PreloadSuggestions season={season} onLoad={(list) => { setAllSuggestions(list); allSuggRef.current = list; }} />

          {/* Theme toggle */}
          <button
            onClick={() => setThemeDark((d) => !d)}
            className={`${themeDark ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700" : "bg-white border-slate-300 text-slate-800 hover:bg-slate-50"} absolute top-3 right-3 border rounded-md px-3 py-1 text-xs font-semibold`}
            aria-label="Toggle color theme"
          >
            {themeDark ? 'Light Mode' : 'Dark Mode'}
          </button>

          {/* Centered player search */}
          <div ref={searchBoxRef} className="w-full max-w-md mx-auto px-3">
            <div className="relative">
              <input
                type="text"
                value={searchName}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => { if (nameSuggestions.length > 0) { setShowNameSuggestions(true); setHighlightIndex(0); } }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setShowNameSuggestions(true);
                    setHighlightIndex(idx => Math.min((idx < 0 ? 0 : idx) + 1, Math.max(0, nameSuggestions.length - 1)));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightIndex(idx => Math.max((idx < 0 ? 0 : idx) - 1, 0));
                  } else if (e.key === 'Enter') {
                    if (showNameSuggestions && nameSuggestions.length > 0) {
                      e.preventDefault();
                      const ii = highlightIndex >= 0 ? highlightIndex : 0;
                      const choice = nameSuggestions[ii];
                      if (choice) handleSelectSuggestion(choice);
                    }
                  } else if (e.key === 'Escape') {
                    setShowNameSuggestions(false);
                  }
                }}
                placeholder="Search NBA players..."
                className={`w-full rounded-md border px-3 py-2 text-sm ${themeDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-400' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-500'}`}
                aria-label="Search players"
              />
              {showNameSuggestions && nameSuggestions.length > 0 && (
                <div className={`absolute left-0 right-0 mt-1 rounded-md border shadow-lg max-h-80 overflow-auto custom-scrollbar z-50 ${themeDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
                  <ul className="py-1 divide-y divide-slate-700/40">
                    {nameSuggestions.map((s, idx) => (
                      <li key={`${s.full}|${s.teamAbbr || ''}`}>
                        <button
                          type="button"
                          onClick={() => handleSelectSuggestion(s)}
                          onMouseEnter={() => setHighlightIndex(idx)}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between ${
                            idx === highlightIndex ? (themeDark ? 'bg-slate-800' : 'bg-slate-100') : ''
                          }`}
                        >
                          <span className={`${themeDark ? 'text-slate-100' : 'text-slate-900'}`}>{s.full}</span>
                          <span className={`ml-3 text-[10px] font-mono rounded px-1 py-0.5 ${themeDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>{s.teamAbbr || '—'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Player bio (top-left) */}
          <div className="absolute top-6 left-3 text-left">
            <div className={`text-xl font-bold leading-6 ${themeDark ? 'text-white' : 'text-slate-900'}`}>
              {displayName || playerBio?.name || '—'}
            </div>
            <div className={`text-base leading-5 ${themeDark ? 'text-slate-200' : 'text-slate-700'}`}>
              {playerBio ? (formatHeightText(playerBio.heightFeet, playerBio.heightInches) || 'Height N/A') : 'Height N/A'}
            </div>
            <div className={`text-base leading-5 ${themeDark ? 'text-slate-200' : 'text-slate-700'}`}>
              {playerBio?.position || 'Position N/A'}
            </div>
          </div>

          {/* Top-right season averages (PTS/REB/AST/3PT%) */}
          <div className="absolute top-1 right-60">
            <div className={`rounded-md border px-2 py-2 ${themeDark ? 'bg-slate-800/70 border-slate-700' : 'bg-slate-900/80 border-slate-800'}`}>
              <div className="grid grid-cols-[30px_auto] gap-x-2 gap-y-2 items-center text-white">
                <span className="text-[9px] font-mono leading-none">pts</span>
                <span className="text-sm font-semibold font-mono leading-none">{seasonAverages?.pts != null ? seasonAverages.pts.toFixed(1) : 'N/A'}</span>
                <span className="text-[9px] font-mono leading-none">reb</span>
                <span className="text-sm font-semibold font-mono leading-none">{seasonAverages?.reb != null ? seasonAverages.reb.toFixed(1) : 'N/A'}</span>
                <span className="text-[9px] font-mono leading-none">ast</span>
                <span className="text-sm font-semibold font-mono leading-none">{seasonAverages?.ast != null ? seasonAverages.ast.toFixed(1) : 'N/A'}</span>
                <span className="text-[9px] font-mono leading-none">3P%</span>
                <span className="text-sm font-semibold font-mono leading-none">{seasonAverages?.fg3_pct != null ? `${(seasonAverages.fg3_pct * 100).toFixed(1)}%` : 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Team vs Team row */}
          <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 min-w-[112px] justify-end">
                {playerTeam ? (
                  <img
                    src={getTeamLogoUrl(playerTeam) ?? undefined}
                    alt={`${playerTeam} logo`}
                    className="w-7 h-7 object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : null}
                <span className={`text-sm font-semibold ${themeDark ? 'text-slate-200' : 'text-slate-800'}`}>{playerTeam || 'N/A'}</span>
              </div>
              <span className={`text-xs font-mono ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>vs</span>
              <div className="flex items-center gap-2 min-w-[112px]">
                <span className={`text-sm font-semibold ${themeDark ? 'text-slate-200' : 'text-slate-800'}`}>{opponentTeam || 'N/A'}</span>
                {opponentTeam ? (
                  <img
                    src={getTeamLogoUrl(opponentTeam) ?? undefined}
                    alt={`${opponentTeam} logo`}
                    className="w-7 h-7 object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : null}
              </div>
              <span className={`text-xs font-mono ${themeDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {nextMatch?.dateISO ? new Date(nextMatch.dateISO).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="w-full mt-4">
          <div className="w-full flex flex-col md:flex-row md:flex-nowrap gap-3 items-start">
            {/* Left column: split into two stacked cards */}
            <div className="md:w-[280px] md:shrink-0 flex-none overflow-y-auto overflow-x-hidden custom-scrollbar" style={{ marginLeft: `-${leftLimit}px`, maxHeight: '85vh' }}>
              <div className="flex flex-col gap-3 pb-4">
                {/* Individual Player Stats (top half) */}
                <div
                  className={`rounded-xl shadow-sm ${themeDark ? "bg-slate-900 border border-slate-800" : "bg-white border-slate-200"} flex flex-col`}
                  style={{ position: "relative", zIndex: 10 }}
                >
                  <div
                    className={`px-2 py-0.5 border-b text-[9px] font-mono tracking-wider rounded-t-xl ${
                      themeDark ? "text-slate-300 bg-slate-900 border-slate-800" : "text-slate-700 bg-slate-50 border-slate-200"
                    }`}
                  >
                    INDIVIDUAL PLAYER STATS
                  </div>
                  <div className="p-1">
                    <div className="h-full flex flex-col justify-between text-[11px] leading-4">
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>PIE <Info desc={DESC.pie} avg={fmtAvg('pie')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.player_efficiency_rating != null && adv.player_efficiency_rating > 0) ? colorForMetric('pie', adv.player_efficiency_rating) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingAdv ? "…" : (adv?.player_efficiency_rating != null && adv.player_efficiency_rating > 0) ? adv.player_efficiency_rating.toFixed(3) : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Usage Rate <Info desc={DESC.usage} avg={fmtAvg('usage')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.usage_percentage != null && adv.usage_percentage > 0) ? colorForMetric('usage', adv.usage_percentage) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingAdv ? "…" : (adv?.usage_percentage != null && adv.usage_percentage > 0) ? `${(adv.usage_percentage * 100).toFixed(1)}%` : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Pace <Info desc={DESC.pace} avg={fmtAvg('pace')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.pace != null && adv.pace > 0) ? colorForMetric('pace', adv.pace) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>{loadingAdv ? "…" : (adv?.pace != null && adv.pace > 0) ? adv.pace.toFixed(1) : "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>True Shooting <Info desc={DESC.ts} avg={fmtAvg('ts')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.true_shooting_percentage != null && adv.true_shooting_percentage > 0) ? colorForMetric('ts', adv.true_shooting_percentage) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingAdv ? "…" : (adv?.true_shooting_percentage != null && adv.true_shooting_percentage > 0) ? `${(adv.true_shooting_percentage * 100).toFixed(1)}%` : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Effective FG% <Info desc={DESC.efg} avg={fmtAvg('efg')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.effective_field_goal_percentage != null && adv.effective_field_goal_percentage > 0) ? colorForMetric('efg', adv.effective_field_goal_percentage) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingAdv ? "…" : (adv?.effective_field_goal_percentage != null && adv.effective_field_goal_percentage > 0) ? `${(adv.effective_field_goal_percentage * 100).toFixed(1)}%` : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Off Rating <Info desc={DESC.off} avg={fmtAvg('off')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.offensive_rating != null && adv.offensive_rating > 0) ? colorForMetric('off', adv.offensive_rating) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>{loadingAdv ? "…" : (adv?.offensive_rating != null && adv.offensive_rating > 0) ? adv.offensive_rating.toFixed(1) : "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Def Rating <Info desc={DESC.def} avg={fmtAvg('def')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.defensive_rating != null && adv.defensive_rating > 0) ? colorForMetric('def', adv.defensive_rating) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>{loadingAdv ? "…" : (adv?.defensive_rating != null && adv.defensive_rating > 0) ? adv.defensive_rating.toFixed(1) : "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Assist % <Info desc={DESC.astPct} avg={fmtAvg('astPct')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.assist_percentage != null && adv.assist_percentage > 0) ? colorForMetric('astPct', adv.assist_percentage) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingAdv ? "…" : (adv?.assist_percentage != null && adv.assist_percentage > 0) ? `${(adv.assist_percentage * 100).toFixed(1)}%` : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>AST/TO Ratio <Info desc={DESC.astTo} avg={fmtAvg('astTo')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.assist_to_turnover_ratio != null && adv.assist_to_turnover_ratio > 0) ? colorForMetric('astTo', adv.assist_to_turnover_ratio) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>{loadingAdv ? "…" : (adv?.assist_to_turnover_ratio != null && adv.assist_to_turnover_ratio > 0) ? adv.assist_to_turnover_ratio.toFixed(2) : "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Turnover Ratio <Info desc={DESC.tovRatio} avg={fmtAvg('tovRatio')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.turnover_ratio != null && adv.turnover_ratio > 0) ? colorForMetric('tovRatio', adv.turnover_ratio) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>{loadingAdv ? "…" : (adv?.turnover_ratio != null && adv.turnover_ratio > 0) ? adv.turnover_ratio.toFixed(3) : "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Total Reb % <Info desc={DESC.trbPct} avg={fmtAvg('trbPct')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.rebound_percentage != null && adv.rebound_percentage > 0) ? colorForMetric('trbPct', adv.rebound_percentage) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingAdv ? "…" : (adv?.rebound_percentage != null && adv.rebound_percentage > 0) ? `${(adv.rebound_percentage * 100).toFixed(1)}%` : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Def Reb % <Info desc={DESC.drbPct} avg={fmtAvg('drbPct')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (adv?.defensive_rebound_percentage != null && adv.defensive_rebound_percentage > 0) ? colorForMetric('drbPct', adv.defensive_rebound_percentage) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingAdv ? "…" : (adv?.defensive_rebound_percentage != null && adv.defensive_rebound_percentage > 0) ? `${(adv.defensive_rebound_percentage * 100).toFixed(1)}%` : "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Net Rating <Info desc={DESC.net} avg={fmtAvg('net')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingAdv ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          adv?.net_rating != null ? colorForMetric('net', adv.net_rating) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>{loadingAdv ? "…" : adv?.net_rating != null ? adv.net_rating.toFixed(1) : "N/A"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={themeDark ? "text-slate-300" : "text-slate-700"}>Clutch Usage <Info desc={DESC.clutchUsage} avg={fmtAvg('clutchUsage')} /></span>
                        <span className={`font-mono font-semibold ${
                          loadingClutch ? (themeDark ? "text-slate-400" : "text-slate-500") :
                          (clutch?.clutch_usage != null && clutch.clutch_usage > 0) ? colorForMetric('clutchUsage', clutch.clutch_usage) :
                          (themeDark ? "text-slate-500" : "text-slate-400")
                        }`}>
                          {loadingClutch ? "…" : (clutch?.clutch_usage != null && clutch.clutch_usage > 0) ? `${(clutch.clutch_usage * 100).toFixed(1)}%` : "N/A"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Team Matchup with Bars */}
                <TeamMatchupBars 
                  playerTeam={playerTeam}
                  opponentTeam={opponentTeam}
                  themeDark={themeDark}
                  matchupData={[
                    {
                      metric: 'Total Yards',
                      playerTeamValue: 307.2,
                      playerTeamRank: 24,
                      opponentTeamValue: 327.0,
                      opponentTeamRank: 18,
                      isHigherBetter: true
                    },
                    {
                      metric: 'Pass Yards', 
                      playerTeamValue: 190.4,
                      playerTeamRank: 25,
                      opponentTeamValue: 242.2,
                      opponentTeamRank: 26,
                      isHigherBetter: true
                    },
                    {
                      metric: 'Pass TDs',
                      playerTeamValue: 1.2,
                      playerTeamRank: 29,
                      opponentTeamValue: 1.8,
                      opponentTeamRank: 22,
                      isHigherBetter: true
                    },
                    {
                      metric: 'Pass Attempts',
                      playerTeamValue: 36.2,
                      playerTeamRank: 8,
                      opponentTeamValue: 31.2,
                      opponentTeamRank: 15,
                      isHigherBetter: true
                    },
                    {
                      metric: 'Completion %',
                      playerTeamValue: 66.3,
                      playerTeamRank: 17,
                      opponentTeamValue: 71.2,
                      opponentTeamRank: 29,
                      isHigherBetter: true
                    },
                    {
                      metric: 'Rush Yards',
                      playerTeamValue: 116.8,
                      playerTeamRank: 15,
                      opponentTeamValue: 85.6,
                      opponentTeamRank: 4,
                      isHigherBetter: true
                    },
                    {
                      metric: 'Rush TDs',
                      playerTeamValue: 0.4,
                      playerTeamRank: 26,
                      opponentTeamValue: 0.4,
                      opponentTeamRank: 6,
                      isHigherBetter: true
                    }
                  ]}
                />
                </div>
                </div>
                </div>
                </div>
                </div>

            {/* Chart: centered inner container with dynamic max width */}
            <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar" style={{ maxHeight: '80vh' }}>
              <div ref={centerRef} className="pb-4" style={{ maxWidth: '100%' }}>
                <div
                  className={(themeDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200') + ' relative rounded-xl overflow-hidden shadow-sm p-3'}
                  style={{ height: panelHeight + 'px' }}
                >
                  {/* Top controls: Stat selector on top, line on left below, timeframe on right below */}
                  <div className="flex flex-col gap-2 mb-2">
                    {/* Row 1: stat selector full-width, left aligned */}
                    <div className="w-full">
                      <div
                        ref={statScrollRef}
                        className={'stat-scroll ' + (themeDark ? 'stat-scroll--dark' : 'stat-scroll--light') + ' overflow-x-auto custom-scrollbar flex flex-nowrap items-center gap-1.5 whitespace-nowrap w-full'}
                      >
                        {([
                          { k: 'min', label: 'MIN' },
                          { k: 'pts', label: 'PTS' },
                          { k: 'reb', label: 'REB' },
                          { k: 'ast', label: 'AST' },
                          { k: 'fg3m', label: '3PM' },
                          { k: 'fg3a', label: '3PA' },
                          { k: 'fg3_pct', label: '3P%' },
                          { k: 'pra', label: 'PRA' },
                          { k: 'pr', label: 'PR' },
                          { k: 'pa', label: 'PA' },
                          { k: 'ra', label: 'RA' },
                          { k: 'stl', label: 'STL' },
                          { k: 'blk', label: 'BLK' },
                          { k: 'fgm', label: 'FGM' },
                          { k: 'fga', label: 'FGA' },
                          { k: 'fg_pct', label: 'FG%' },
                          { k: 'oreb', label: 'OREB' },
                          { k: 'dreb', label: 'DREB' },
                          { k: 'ftm', label: 'FTM' },
                          { k: 'fta', label: 'FTA' },
                          { k: 'ft_pct', label: 'FT%' },
                          { k: 'to', label: 'TO' },
                          { k: 'pf', label: 'PF' },
                        ] as { k: any; label: string }[]).map(({ k, label }) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setChartMetric(k)}
                            className={(
                              chartMetric === k
                                ? (themeDark
                                  ? 'bg-indigo-700 border-indigo-600 text-white'
                                  : 'bg-indigo-100 border-indigo-300 text-indigo-800')
                                : (themeDark
                                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')
                            ) + ' inline-flex px-3 py-1.5 text-xs rounded-md border transition'}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Row 2: line adjuster (left) and timeframe filters (right) inline */}
                    <div className="flex items-center justify-between">
                      {/* Line selector - left side */}
                      <div className="flex items-center gap-2">
                        <span className={(themeDark ? 'text-slate-300' : 'text-slate-700') + ' text-xs font-mono'}>Line</span>
                        <input
                          type="number"
                          step={0.5}
                          min={0}
                          value={propLine}
                          onChange={(e) => {
                            const n = parseFloat(e.currentTarget.value);
                            if (!isNaN(n)) {
                              const snapped = Math.max(0, Math.round(n * 2) / 2);
                              setPropLine(parseFloat(snapped.toFixed(1)));
                            }
                          }}
                          onBlur={(e) => {
                            const n = parseFloat(e.currentTarget.value);
                            if (!isNaN(n)) {
                              const snapped = Math.max(0, Math.round(n * 2) / 2);
                              setPropLine(parseFloat(snapped.toFixed(1)));
                            }
                          }}
                          className={(themeDark ? 'bg-slate-900 text-white border-slate-800' : 'bg-white text-black border-slate-200') + ' px-3 py-1.5 w-20 text-sm font-mono text-center border rounded-md outline-none'}
                          aria-label="Set line value"
                        />
                      </div>
                      
                      {/* Right side: timeframe filters */}
                      <div className="flex items-center gap-1">
                        {([
                          { k: 'last5', label: 'Last 5' },
                          { k: 'last10', label: 'Last 10' },
                          { k: 'last20', label: 'Last 20' },
                          { k: 'h2h', label: 'H2H' },
                          { k: 'lastSeason', label: 'Last Season' },
                          { k: 'thisSeason', label: 'This Season' },
                        ] as { k: 'last5' | 'last10' | 'last20' | 'h2h' | 'lastSeason' | 'thisSeason'; label: string }[]).map(({ k, label }) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setTimeFilter(k)}
                          className={(
                            timeFilter === k
                              ? (themeDark
                                ? 'bg-emerald-700 border-emerald-600 text-white'
                                : 'bg-emerald-100 border-emerald-300 text-emerald-800')
                              : (themeDark
                                ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')
                          ) + ' px-2 py-1 text-xs rounded-md border transition'}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {displayedChartData.length === 0 ? (
                    <div className={(themeDark ? 'text-slate-300' : 'text-slate-600') + ' h-full w-full flex items-center justify-center text-sm md:text-base'}>
                      {displayName ? (
                        <>
                          Selected: <span className="ml-2 font-mono font-semibold">{displayName}</span>
                          {timeFilter === 'thisSeason' ? (
                            <span className="ml-2">— N/A (this season)</span>
                          ) : (
                            <span className="ml-2">— Loading Or No Data</span>
                          )}
                        </>
                      ) : (
                        <>No Player Found - Search A Player To Research</>
                      )}
                    </div>
                  ) : (
                    <CanvasChart
                      data={displayedChartData}
                      propLine={propLine}
                      unitLabel={unitLabel}
                      themeDark={themeDark}
                      height={chartInnerHeight}
                      leftMargin={chartMargins.left}
                      rightMargin={chartMargins.right}
                      timeFilter={timeFilter}
                      yHeadroom={0.15}
                      marginTop={48}
                      marginBottom={96}
                    />
                  )}
                  
                  {/* Last updated - bottom left of chart container */}
                  <div className="absolute bottom-2 left-3">
                    <div className={(themeDark ? 'text-slate-500' : 'text-slate-400') + ' text-[10px] font-mono'}>
                      Last updated: {lastUpdatedText || 'N/A'}
                    </div>
                  </div>
                  
                  {/* Ensure bottom hairline is always visible inside card */}
                  <div className={'pointer-events-none absolute left-0 right-0 bottom-0 rounded-b-xl ' + (themeDark ? 'bg-slate-800' : 'bg-slate-200')} style={{ height: '1px' }}></div>
                </div>
                
                {/* Bookmaker Selection */}
                <div className="mt-3 flex items-center gap-2">
                  <span className={(themeDark ? 'text-slate-400' : 'text-slate-600') + ' text-xs font-mono'}>BOOKMAKER:</span>
                  <div className="flex gap-1">
                    {(['fanduel', 'draftkings', 'betmgm', 'fanatics'] as const).map((book) => (
                      <button
                        key={book}
                        type="button"
                        onClick={() => setSelectedBookmaker(book)}
                        className={(
                          selectedBookmaker === book
                            ? (themeDark
                              ? 'bg-blue-700 border-blue-600 text-white'
                              : 'bg-blue-100 border-blue-300 text-blue-800')
                            : (themeDark
                              ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')
                        ) + ' px-2 py-1 text-xs rounded-md border transition font-mono uppercase'}
                      >
                        {book === 'fanduel' ? 'FD' : book === 'draftkings' ? 'DK' : book === 'betmgm' ? 'BM' : 'FAN'}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Player Props Lines container with 40/60 split */}
                <div className="flex gap-3 mt-3">
                  {/* Left Container: Opening & Current Lines (40%) */}
                  <div className={(themeDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border-slate-200') + ' flex-[40] rounded-xl shadow-sm p-4'}>
                    {/* Header */}
                    <div className="mb-3">
                      <div className={(themeDark ? 'text-slate-300' : 'text-slate-700') + ' text-xs font-mono'}>
                        Player Props Lines • <span className="font-bold uppercase">{String(chartMetric)}</span> - <span className="font-normal">{selectedBookmaker === 'fanduel' ? 'FanDuel' : selectedBookmaker === 'draftkings' ? 'DraftKings' : selectedBookmaker === 'betmgm' ? 'BetMGM' : 'Fanatics'}</span>
                      </div>
                    </div>
                    
                    {/* Opening & Current Lines Content */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={(themeDark ? 'text-slate-400' : 'text-slate-600') + ' text-xs font-mono'}>OPENING {String(chartMetric).toUpperCase()} LINE</span>
                        <span className={(themeDark ? 'text-slate-500' : 'text-slate-400') + ' text-sm font-bold font-mono'}>
                          {openingLines[selectedBookmaker]?.[String(chartMetric)] ?? 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={(themeDark ? 'text-slate-400' : 'text-slate-600') + ' text-xs font-mono'}>CURRENT {String(chartMetric).toUpperCase()} LINE</span>
                        <span className={(themeDark ? 'text-slate-500' : 'text-slate-400') + ' text-sm font-bold font-mono'}>
                          {currentLines[selectedBookmaker]?.[String(chartMetric)] ?? 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Right Container: Line Movement (60%) */}
                  <div className={(themeDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border-slate-200') + ' flex-[60] rounded-xl shadow-sm p-4'}>
                    {/* Header */}
                    <div className="mb-3">
                      <div className={(themeDark ? 'text-slate-300' : 'text-slate-700') + ' text-xs font-mono'}>
                        LINE MOVEMENT - <span className="font-normal">{selectedBookmaker === 'fanduel' ? 'FanDuel' : selectedBookmaker === 'draftkings' ? 'DraftKings' : selectedBookmaker === 'betmgm' ? 'BetMGM' : 'Fanatics'}</span>
                      </div>
                    </div>
                    
                    {/* Line Movement Container with Content */}
                    <div className="max-h-20 overflow-y-auto custom-scrollbar">
                      {/* Line Movement Content - Mock Data Based on Selected Bookmaker */}
                      <div className="space-y-2">
                        {(() => {
                          // Mock data that varies by bookmaker
                          const mockLineMovements = {
                            fanduel: [
                              { time: '10:30 AM', line: '25.5', change: '+0.5', direction: 'up' },
                              { time: '11:45 AM', line: '25.0', change: '-0.5', direction: 'down' },
                              { time: '2:15 PM', line: '25.5', change: '+0.5', direction: 'up' },
                              { time: '4:30 PM', line: '24.5', change: '-1.0', direction: 'down' },
                              { time: '5:45 PM', line: '25.0', change: '+0.5', direction: 'up' },
                              { time: '6:20 PM', line: '25.5', change: '+0.5', direction: 'up' },
                              { time: '7:10 PM', line: '25.0', change: '-0.5', direction: 'down' },
                              { time: '8:30 PM', line: '26.0', change: '+1.0', direction: 'up' },
                              { time: '9:15 PM', line: '25.5', change: '-0.5', direction: 'down' }
                            ],
                            draftkings: [
                              { time: '10:15 AM', line: '26.0', change: '+0.5', direction: 'up' },
                              { time: '11:30 AM', line: '25.5', change: '-0.5', direction: 'down' },
                              { time: '1:45 PM', line: '26.0', change: '+0.5', direction: 'up' },
                              { time: '3:20 PM', line: '25.0', change: '-1.0', direction: 'down' },
                              { time: '4:50 PM', line: '25.5', change: '+0.5', direction: 'up' },
                              { time: '6:10 PM', line: '26.0', change: '+0.5', direction: 'up' },
                              { time: '7:35 PM', line: '25.5', change: '-0.5', direction: 'down' },
                              { time: '8:45 PM', line: '26.5', change: '+1.0', direction: 'up' }
                            ],
                            betmgm: [
                              { time: '9:45 AM', line: '24.5', change: '+0.5', direction: 'up' },
                              { time: '11:20 AM', line: '24.0', change: '-0.5', direction: 'down' },
                              { time: '1:30 PM', line: '24.5', change: '+0.5', direction: 'up' },
                              { time: '3:45 PM', line: '25.0', change: '+0.5', direction: 'up' },
                              { time: '5:15 PM', line: '24.5', change: '-0.5', direction: 'down' },
                              { time: '6:40 PM', line: '25.0', change: '+0.5', direction: 'up' },
                              { time: '8:10 PM', line: '25.5', change: '+0.5', direction: 'up' }
                            ],
                            fanatics: [
                              { time: '10:00 AM', line: '25.0', change: '+0.5', direction: 'up' },
                              { time: '12:15 PM', line: '24.5', change: '-0.5', direction: 'down' },
                              { time: '2:30 PM', line: '25.0', change: '+0.5', direction: 'up' },
                              { time: '4:45 PM', line: '25.5', change: '+0.5', direction: 'up' },
                              { time: '6:00 PM', line: '25.0', change: '-0.5', direction: 'down' },
                              { time: '7:25 PM', line: '25.5', change: '+0.5', direction: 'up' },
                              { time: '8:50 PM', line: '26.0', change: '+0.5', direction: 'up' }
                            ]
                          };
                          
                          return mockLineMovements[selectedBookmaker].map((movement, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs">
                              <span className={(themeDark ? 'text-slate-400' : 'text-slate-600') + ' font-mono'}>{movement.time}</span>
                              <span className={(
                                movement.direction === 'up'
                                  ? (themeDark ? 'text-green-400' : 'text-green-600')
                                  : (themeDark ? 'text-red-400' : 'text-red-600')
                              ) + ' font-mono font-bold'}>
                                {movement.line} {movement.direction === 'up' ? '↗' : '↘'}
                              </span>
                              <span className={(themeDark ? 'text-slate-500' : 'text-slate-500') + ' font-mono text-[10px]'}>
                                {movement.change}
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Depth Chart container */}
                <div className={(themeDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border-slate-200') + ' mt-3 rounded-xl shadow-sm p-4 min-h-[200px]'}>
                  {/* Header */}
                  <div className="mb-4 text-center">
                    <div className={(themeDark ? 'text-slate-200' : 'text-slate-800') + ' text-lg font-bold font-mono mb-2'}>
                      DEPTH CHART
                    </div>
                    <div className={(themeDark ? 'text-slate-400' : 'text-slate-600') + ' text-xs font-mono'}>
                      Team: <span className="font-bold uppercase">{playerTeam || 'N/A'}</span>
                    </div>
                  </div>
                  
                  {/* Depth Chart Content */}
                  {loadingDepthChart ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full" />
                      <span className={`ml-3 text-sm ${themeDark ? "text-slate-300" : "text-slate-700"}`}>Loading depth chart...</span>
                    </div>
                  ) : (() => {
                    const depthChart = createDepthChart(teamRoster);
                    
                    // If no real depth chart data available, show message
                    if (!depthChart) {
                      return (
                        <div className={`text-center py-8 ${themeDark ? "text-slate-400" : "text-slate-600"}`}>
                          <div className="text-sm mb-2">No Live Depth Chart Available</div>
                          <div className={`text-xs ${themeDark ? "text-slate-500" : "text-slate-400"}`}>
                            {playerTeam ? `Unable to load current depth chart data for ${playerTeam}` : 'Select a player to view team depth chart'}
                          </div>
                        </div>
                      );
                    }
                    
                    const maxDepth = Math.max(
                      depthChart.PG.length,
                      depthChart.SG.length,
                      depthChart.SF.length,
                      depthChart.PF.length,
                      depthChart.C.length
                    );
                    
                    const positions = [
                      { key: 'PG', label: 'PG' },
                      { key: 'SG', label: 'SG' },
                      { key: 'SF', label: 'SF' },
                      { key: 'PF', label: 'PF' },
                      { key: 'C', label: 'C' }
                    ];
                    
                    return (
                      <div className="overflow-x-auto">
                        <div className="min-w-full">
                          {/* Depth Headers (top row) */}
                          <div
                            className="grid gap-1 mb-2"
                            style={{
                              gridTemplateColumns: `minmax(50px, 0.8fr) ${Array.from({ length: maxDepth }).map(() => 'minmax(70px, 1fr)').join(' ')}`
                            }}
                          >
                            <div></div> {/* Empty corner cell */}
                            {Array.from({ length: maxDepth }, (_, index) => (
                              <div key={index} className={`text-center font-bold py-1.5 rounded text-xs ${themeDark ? "bg-slate-700 text-purple-300" : "bg-slate-200 text-purple-700"}`}>
                                {index === 0 ? 'STARTER' : index === 1 ? '2ND' : index === 2 ? '3RD' : index === 3 ? '4TH' : `${index + 1}TH`}
                              </div>
                            ))}
                          </div>
                          
                          {/* Position Rows */}
                          {positions.map((position) => (
                            <div
                              key={position.key}
                              className="grid gap-1 mb-1"
                            style={{
                              gridTemplateColumns: `minmax(50px, 0.8fr) ${Array.from({ length: maxDepth }).map(() => 'minmax(70px, 1fr)').join(' ')}`
                            }}
                            >
                              {/* Position Label */}
                              <div className={`flex items-center justify-center font-bold py-1.5 px-2 rounded text-xs ${themeDark ? "bg-slate-700 text-purple-300" : "bg-slate-200 text-purple-700"}`}>
                                {position.label}
                              </div>
                              
                              {/* Players for this position across depth */}
                              {Array.from({ length: maxDepth }, (_, depthIndex) => {
                                const player = depthChart[position.key as keyof typeof depthChart][depthIndex];
                                return (
                                  <div key={depthIndex} className="flex justify-center">
                                    {player ? (
                                      <div
                                        className={`relative w-full p-1 text-center rounded border text-xs h-12 flex flex-col justify-center ${
                                          player.name === displayName
                                            ? themeDark
                                              ? 'bg-purple-900/70 border-purple-400 text-purple-200'
                                              : 'bg-purple-50 border-purple-400 text-purple-900'
                                            : themeDark
                                            ? 'bg-slate-800/50 text-slate-300 border-slate-600'
                                            : 'bg-white text-slate-800 border-slate-200'
                                        }`}
                                      >
                                        <div className="font-semibold mb-1 text-xs leading-tight">
                                          {player.name}
                                        </div>
                                        <div className={`text-xs flex items-center justify-center gap-2 opacity-70`}>
                                          <span>#{player.jersey}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className={`w-full p-2 rounded border-2 border-dashed h-12 ${
                                        themeDark ? 'border-slate-600' : 'border-slate-300'
                                      }`}></div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Right column: split into two stacked cards */}
            <div className="md:w-[280px] md:shrink-0 flex-none overflow-y-auto overflow-x-hidden custom-scrollbar" style={{ marginRight: `-${leftLimit}px`, maxHeight: '85vh' }}>
              <div className="flex flex-col gap-3 pb-4">
                {/* Defensive Breakdown (top half) */}
                <div
                  className={`rounded-xl shadow-sm ${themeDark ? "bg-slate-900 border border-slate-800" : "bg-white border-slate-200"} flex flex-col`}
                  style={{ position: "relative", zIndex: 10 }}
                >
                  <div
                    className={`px-3 py-1.5 border-b text-[11px] font-mono tracking-wider rounded-t-xl ${
                      themeDark ? "text-slate-300 bg-slate-900 border-slate-800" : "text-slate-700 bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>DEFENSIVE BREAKDOWN</span>
                      <span className={`text-[10px] ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                        {opponentTeam ? `— ${normalizeAbbr(opponentTeam)}` : "— N/A"}
                        {nextMatch?.dateISO ? ` • ${new Date(nextMatch.dateISO).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="p-1">
                    <div className="h-full flex flex-col text-[11px] leading-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>PTS ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "ptsAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "ptsAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "ptsAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "ptsAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "ptsAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>REB ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "rebAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "rebAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "rebAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "rebAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "rebAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>AST ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "astAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "astAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "astAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "astAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "astAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>FGM ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "fgmAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "fgmAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "fgmAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "fgmAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "fgmAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>FGA ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "fgaAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "fgaAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "fgaAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "fgaAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "fgaAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>3PM ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "fg3mAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "fg3mAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "fg3mAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "fg3mAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "fg3mAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>3PA ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "fg3aAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "fg3aAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "fg3aAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "fg3aAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "fg3aAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>STL ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "stlAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "stlAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "stlAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "stlAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "stlAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-medium ${themeDark ? "text-slate-300" : "text-slate-700"}`}>BLK ALLOWED</span>
                          <div className="flex flex-col items-end">
                            <span
                              className={`text-sm font-bold ${getOpponentDefensiveRankColor(getOpponentDefensiveRank(opponentTeam, "blkAllowed"))}`}
                            >
{(!opponentTeam || getOpponentDefensiveRank(opponentTeam, "blkAllowed") == null) ? "N/A" : getOrdinalSuffix(getOpponentDefensiveRank(opponentTeam, "blkAllowed") as number)}
                            </span>
                            <span className={`text-[10px] font-mono ${themeDark ? "text-slate-400" : "text-slate-500"}`}>
                              {(!opponentTeam) ? "N/A" : (getOpponentDefensiveValue(opponentTeam, "blkAllowed") != null ? getOpponentDefensiveValue(opponentTeam, "blkAllowed").toFixed(1) : "N/A")}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className={`${themeDark ? "border-slate-800 text-white" : "border-slate-200 text-black"} mt-2 pt-1 border-t text-[10px] italic`}>
                        Rankings refresh shortly after the final game of the day.
                      </div>
                    </div>
                  </div>
                </div>
                {/* Value Analysis (bottom) */}
                <div
                  className={`rounded-xl shadow-sm ${themeDark ? "bg-slate-900 border border-slate-800" : "bg-white border-slate-200"} flex flex-col`}
                  style={{ position: "relative", zIndex: 10, minHeight: "160px" }}
                >
                  <div className={`px-3 py-2 border-b w-full text-[11px] font-mono tracking-wider rounded-t-xl ${themeDark ? "text-slate-300 bg-slate-900 border-slate-800" : "text-slate-700 bg-slate-50 border-slate-200"}`}>
                    <div className="flex items-center justify-between">
                      <span>VALUE ANALYSIS</span>
                      <div className="flex items-center gap-2">
                        {/* Independent bookmaker selector */}
                        <select
                          value={selectedBookmaker}
                          onChange={(e) => setSelectedBookmaker(e.target.value as any)}
                          className={`px-2 py-1 text-[10px] font-mono rounded border ${themeDark ? 'bg-slate-800 border-slate-600 text-white' : 'bg-white border-slate-300 text-black'}`}
                        >
                          <option value="fanduel">FANDUEL</option>
                          <option value="draftkings">DRAFTKINGS</option>
                          <option value="betmgm">BETMGM</option>
                          <option value="fanatics">FANATICS</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="space-y-2">
                      {(() => {
                        // Check if we have real odds data (for now, we don't - so show N/A)
                        const hasRealOdds = false; // This will be true when real odds API is integrated
                        
                        if (!hasRealOdds) {
                          return (
                            <>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>LINE</span>
                                <span className={`text-sm font-bold ${themeDark ? "text-slate-500" : "text-slate-400"}`}>N/A</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>IMPLIED PROB</span>
                                <span className={`text-sm font-bold ${themeDark ? "text-slate-500" : "text-slate-400"}`}>N/A</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>HIT RATE</span>
                                <span className={`text-sm font-bold ${themeDark ? "text-slate-500" : "text-slate-400"}`}>N/A</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>EDGE</span>
                                <span className={`text-sm font-bold ${themeDark ? "text-slate-500" : "text-slate-400"}`}>N/A</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>ODDS</span>
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${themeDark ? "bg-slate-800 text-slate-400" : "bg-slate-200 text-slate-500"}`}>
                                    Over (N/A)
                                  </span>
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${themeDark ? "bg-slate-800 text-slate-400" : "bg-slate-200 text-slate-500"}`}>
                                    Under (N/A)
                                  </span>
                                </div>
                              </div>
                            </>
                          );
                        }
                        
                        // This code will run when real odds are available
                        const getBookmakerData = (bookmaker: string) => {
                          switch(bookmaker) {
                            case 'fanduel':
                              return {
                                line: (Math.floor(propLine) + 0.5).toFixed(1),
                                overOdds: -108,
                                underOdds: -112
                              };
                            case 'draftkings':
                              return {
                                line: (Math.floor(propLine) - 0.5).toFixed(1),
                                overOdds: -110,
                                underOdds: -110
                              };
                            case 'betmgm':
                              return {
                                line: (Math.floor(propLine) + 1.5).toFixed(1),
                                overOdds: -105,
                                underOdds: -115
                              };
                            case 'fanatics':
                              return {
                                line: (Math.floor(propLine) + 0.5).toFixed(1),
                                overOdds: -112,
                                underOdds: -108
                              };
                            default:
                              return {
                                line: propLine.toFixed(1),
                                overOdds: -110,
                                underOdds: -110
                              };
                          }
                        };
                        
                        const bookmakerData = getBookmakerData(selectedBookmaker);
                        const bookmakerLine = parseFloat(bookmakerData.line);
                        
                        // Calculate implied probability for OVER bet
                        const overOdds = bookmakerData.overOdds;
                        const impliedProbOver = overOdds < 0 
                          ? (Math.abs(overOdds) / (Math.abs(overOdds) + 100)) * 100
                          : (100 / (overOdds + 100)) * 100;
                        
                        // Calculate actual hit rate from recent games for this line
                        const recentGames = displayedChartData.slice(-10); // Last 10 games
                        const hitsOver = recentGames.filter(game => game.value > bookmakerLine).length;
                        const actualHitRate = recentGames.length > 0 ? (hitsOver / recentGames.length) * 100 : 0;
                        
                        // Calculate expected value
                        const expectedValue = (actualHitRate / 100) - (impliedProbOver / 100);
                        const valuePercentage = expectedValue * 100;
                        
                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>LINE</span>
                              <span className={`text-sm font-bold ${themeDark ? "text-white" : "text-black"}`}>O/U {bookmakerData.line}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>IMPLIED PROB</span>
                              <span className={`text-sm font-bold ${themeDark ? "text-white" : "text-black"}`}>{impliedProbOver.toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>HIT RATE</span>
                              <span className={`text-sm font-bold ${themeDark ? "text-white" : "text-black"}`}>{actualHitRate.toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>EDGE</span>
                              <span className={`text-sm font-bold ${
                                valuePercentage > 0 
                                  ? (themeDark ? "text-green-400" : "text-green-500")
                                  : valuePercentage < 0
                                  ? (themeDark ? "text-red-400" : "text-red-500")
                                  : (themeDark ? "text-slate-400" : "text-slate-500")
                              }`}>
                                {valuePercentage > 0 ? `+${valuePercentage.toFixed(1)}%` : `${valuePercentage.toFixed(1)}%`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-mono ${themeDark ? "text-slate-400" : "text-slate-600"}`}>ODDS</span>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${themeDark ? "bg-green-900 text-green-300" : "bg-green-100 text-green-700"}`}>
                                  Over ({(() => {
                                    if (oddsFormat === 'decimal') {
                                      const decimal = overOdds < 0 
                                        ? (100 / Math.abs(overOdds) + 1).toFixed(2)
                                        : (overOdds / 100 + 1).toFixed(2);
                                      return decimal;
                                    } else {
                                      return overOdds;
                                    }
                                  })()})
                                </span>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${themeDark ? "bg-red-900 text-red-300" : "bg-red-100 text-red-700"}`}>
                                  Under ({(() => {
                                    const underOdds = bookmakerData.underOdds;
                                    if (oddsFormat === 'decimal') {
                                      const decimal = underOdds < 0 
                                        ? (100 / Math.abs(underOdds) + 1).toFixed(2)
                                        : (underOdds / 100 + 1).toFixed(2);
                                      return decimal;
                                    } else {
                                      return underOdds;
                                    }
                                  })()})
                                </span>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </div>
    </>
  );
}
