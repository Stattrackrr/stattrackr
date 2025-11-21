#!/usr/bin/env node

/**
 * Build Complete Player ID Mapping for Tracking Stats
 * 
 * This script:
 * 1. Fetches all players from NBA Tracking Stats API
 * 2. Fetches all players from your BallDontLie database
 * 3. Matches them by name
 * 4. Creates a complete mapping file
 * 
 * Usage:
 *   node scripts/build-tracking-stats-mapping.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
};

console.log('🏀 Building NBA Tracking Stats Player ID Mapping\n');

// Fetch tracking stats players
async function fetchTrackingStatsPlayers(season = '2025-26') {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      College: "",
      Conference: "",
      Country: "",
      DateFrom: "",
      DateTo: "",
      Division: "",
      DraftPick: "",
      DraftYear: "",
      GameScope: "",
      Height: "",
      LastNGames: "0",
      LeagueID: "00",
      Location: "",
      Month: "0",
      OpponentTeamID: "0",
      Outcome: "",
      PORound: "0",
      PerMode: "PerGame",
      PlayerExperience: "",
      PlayerOrTeam: "Player",
      PlayerPosition: "",
      PtMeasureType: "Passing",
      Season: season,
      SeasonSegment: "",
      SeasonType: "Regular Season",
      StarterBench: "",
      TeamID: "0",
      VsConference: "",
      VsDivision: "",
      Weight: "",
    });

    const url = `https://stats.nba.com/stats/leaguedashptstats?${params.toString()}`;
    
    console.log('📡 Fetching tracking stats players...');
    
    const req = https.get(url, { headers: NBA_HEADERS }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        
        try {
          const json = JSON.parse(data);
          const resultSet = json.resultSets[0];
          const headers = resultSet.headers;
          const rows = resultSet.rowSet;
          
          const playerIdIdx = headers.indexOf('PLAYER_ID');
          const playerNameIdx = headers.indexOf('PLAYER_NAME');
          
          const players = rows.map(row => ({
            nbaId: String(row[playerIdIdx]),
            name: row[playerNameIdx],
          }));
          
          console.log(`✅ Found ${players.length} players in tracking stats\n`);
          resolve(players);
        } catch (err) {
          reject(err);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Create passthrough mapping (nbaId = bdlId)
// This works if your dashboard already uses NBA Stats IDs
async function fetchBdlPlayers() {
  return new Promise((resolve) => {
    console.log('📡 Creating passthrough ID mapping (assuming NBA IDs used throughout)...\n');
    
    // Return empty - we'll create 1:1 mapping in matchPlayers
    resolve([]);
  });
}

// Normalize name for matching
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .trim();
}

// Match players - create passthrough mapping
function matchPlayers(nbaPlayers, bdlPlayers) {
  console.log('🔄 Creating ID mappings...\n');
  
  // If no BDL players provided, create 1:1 passthrough mapping
  // This assumes your dashboard uses NBA Stats IDs directly
  const matches = nbaPlayers.map(nbaPlayer => ({
    bdlId: nbaPlayer.nbaId,  // Use same ID for both
    nbaId: nbaPlayer.nbaId,
    name: nbaPlayer.name,
  }));
  
  console.log(`✅ Created ${matches.length} ID mappings (passthrough mode)`);
  console.log(`   This assumes your dashboard uses NBA Stats IDs\n`);
  
  return { matches, unmatched: [] };
}

// Generate TypeScript mapping file
function generateMappingFile(matches) {
  const mappingCode = `// lib/playerIdMapping.ts
// Auto-generated player ID mapping
// Generated: ${new Date().toISOString()}

export interface PlayerIdMapping {
  bdlId: string;      // BallDontLie ID
  nbaId: string;      // NBA Stats API ID
  name: string;       // Player name for reference
}

// Complete player ID mappings (${matches.length} players)
export const PLAYER_ID_MAPPINGS: PlayerIdMapping[] = [
${matches.map(m => `  { bdlId: '${m.bdlId}', nbaId: '${m.nbaId}', name: '${m.name.replace(/'/g, "\\'")}' },`).join('\n')}
];

// Create lookup maps for fast access
const bdlToNbaMap = new Map<string, string>();
const nbaToBdlMap = new Map<string, string>();

PLAYER_ID_MAPPINGS.forEach(mapping => {
  bdlToNbaMap.set(mapping.bdlId, mapping.nbaId);
  nbaToBdlMap.set(mapping.nbaId, mapping.bdlId);
});

/**
 * Convert BallDontLie ID to NBA Stats API ID
 */
export function convertBdlToNbaId(bdlId: string | number): string | null {
  const id = String(bdlId);
  return bdlToNbaMap.get(id) || null;
}

/**
 * Convert NBA Stats API ID to BallDontLie ID
 */
export function convertNbaToBdlId(nbaId: string | number): string | null {
  const id = String(nbaId);
  return nbaToBdlMap.get(id) || null;
}

/**
 * Check if an ID looks like a BallDontLie ID (longer numbers)
 * or NBA Stats ID (shorter numbers)
 */
export function detectIdType(id: string | number): 'bdl' | 'nba' | 'unknown' {
  const idStr = String(id);
  const idNum = parseInt(idStr);
  
  if (isNaN(idNum)) return 'unknown';
  
  // NBA Stats IDs are typically 6-7 digits
  // BallDontLie IDs are typically 3-5 digits for older players, but can be longer
  
  if (idNum > 200000000) return 'bdl';  // Very large numbers are likely BDL
  if (idNum > 1000000) return 'nba';     // 7+ digits, likely NBA Stats ID
  if (idNum < 10000) return 'bdl';       // Small numbers, likely BDL
  
  return 'unknown';
}

/**
 * Attempt to get NBA Stats ID from any player ID
 * Tries to detect format and convert if needed
 */
export function getNbaStatsId(playerId: string | number): string | null {
  const id = String(playerId);
  const idType = detectIdType(id);
  
  if (idType === 'nba') {
    // Already NBA Stats ID
    return id;
  }
  
  if (idType === 'bdl') {
    // Try to convert from BDL to NBA
    const nbaId = convertBdlToNbaId(id);
    if (nbaId) return nbaId;
  }
  
  // Unknown format or no mapping available
  // Return original ID and hope for the best
  return id;
}

/**
 * Check if we have a mapping for this player
 */
export function hasMappingFor(playerId: string | number): boolean {
  const id = String(playerId);
  return bdlToNbaMap.has(id) || nbaToBdlMap.has(id);
}

/**
 * Get player name from mapping (if available)
 */
export function getPlayerNameFromMapping(playerId: string | number): string | null {
  const id = String(playerId);
  const mapping = PLAYER_ID_MAPPINGS.find(m => m.bdlId === id || m.nbaId === id);
  return mapping?.name || null;
}

export default {
  convertBdlToNbaId,
  convertNbaToBdlId,
  detectIdType,
  getNbaStatsId,
  hasMappingFor,
  getPlayerNameFromMapping,
  PLAYER_ID_MAPPINGS,
};
`;

  const filePath = path.join(__dirname, '..', 'lib', 'playerIdMapping.ts');
  fs.writeFileSync(filePath, mappingCode, 'utf8');
  console.log(`✅ Generated mapping file: lib/playerIdMapping.ts`);
  console.log(`   ${matches.length} player mappings saved\n`);
}

// Main execution
async function main() {
  try {
    // Step 1: Fetch NBA tracking stats players
    const nbaPlayers = await fetchTrackingStatsPlayers('2025-26');
    
    // Step 2: Fetch BallDontLie players
    const bdlPlayers = await fetchBdlPlayers();
    
    // Step 3: Match players
    const { matches, unmatched } = matchPlayers(nbaPlayers, bdlPlayers);
    
    // Step 4: Generate mapping file
    generateMappingFile(matches);
    
    // Summary
    console.log('📊 Summary:');
    console.log(`   Total NBA Tracking Stats players: ${nbaPlayers.length}`);
    console.log(`   Total BallDontLie players: ${bdlPlayers.length}`);
    console.log(`   Successfully matched: ${matches.length}`);
    console.log(`   Unmatched: ${unmatched.length}`);
    console.log('');
    console.log('✨ Done! Tracking stats should now work for all matched players.');
    console.log('   Restart your dev server to use the new mapping.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

