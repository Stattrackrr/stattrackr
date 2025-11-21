// scripts/build-complete-player-mapping.js
// Automatically builds a complete BallDontLie ID to NBA Stats ID mapping

const fs = require('fs');
const path = require('path');

const BALLDONTLIE_API = 'https://api.balldontlie.io/v1';
const NBA_STATS_API = 'https://stats.nba.com/stats';

// Get API key from environment
require('dotenv').config({ path: '.env.local' });
const BDL_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;

// Headers for BallDontLie API
const BDL_HEADERS = BDL_API_KEY ? {
  'Authorization': BDL_API_KEY.startsWith('Bearer ') ? BDL_API_KEY : `Bearer ${BDL_API_KEY}`,
} : {};

// Headers for NBA API
const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
};

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.warn(`Attempt ${i + 1} failed: ${error.message}`);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Fetch all players from BallDontLie API
async function fetchBallDontLiePlayers() {
  console.log('📥 Fetching players from BallDontLie API...');
  
  if (!BDL_API_KEY) {
    console.error('❌ No BallDontLie API key found!');
    console.error('   Please set BALLDONTLIE_API_KEY in .env.local\n');
    return [];
  }

  const allPlayers = [];
  let cursor = null;
  let page = 1;
  const maxPages = 50; // Safety limit

  while (page <= maxPages) {
    try {
      let url = `${BALLDONTLIE_API}/players/active?per_page=100`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }
      
      const data = await fetchWithRetry(url, { headers: BDL_HEADERS });
      
      if (data.data && data.data.length > 0) {
        allPlayers.push(...data.data);
        console.log(`  Page ${page}: ${data.data.length} players (total: ${allPlayers.length})`);
        
        // Check for next cursor
        cursor = data.meta?.next_cursor;
        if (!cursor) break;
        
        page++;
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));
      } else {
        break;
      }
    } catch (error) {
      console.error(`  Error fetching page ${page}:`, error.message);
      break;
    }
  }

  console.log(`✅ Fetched ${allPlayers.length} players from BallDontLie\n`);
  return allPlayers;
}

// Fetch all players from NBA Stats API
async function fetchNBAStatsPlayers() {
  console.log('📥 Fetching players from NBA Stats API...');
  
  try {
    const url = `${NBA_STATS_API}/commonallplayers?LeagueID=00&Season=2024-25&IsOnlyCurrentSeason=0`;
    const data = await fetchWithRetry(url, { headers: NBA_HEADERS });
    
    if (!data.resultSets || !data.resultSets[0]) {
      throw new Error('Invalid response format');
    }

    const headers = data.resultSets[0].headers;
    const rows = data.resultSets[0].rowSet;

    const playerIdIdx = headers.indexOf('PERSON_ID');
    const firstNameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
    const isActiveIdx = headers.indexOf('ROSTERSTATUS');

    const players = rows.map(row => ({
      id: String(row[playerIdIdx]),
      name: row[firstNameIdx],
      isActive: row[isActiveIdx] === 1,
    }));

    console.log(`✅ Fetched ${players.length} players from NBA Stats API\n`);
    return players;
  } catch (error) {
    console.error('❌ Error fetching NBA Stats players:', error.message);
    return [];
  }
}

// Normalize player name for matching
function normalizeName(name) {
  return name
    .toLowerCase()
    // Remove accents/diacritics
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Handle special characters
    .replace(/đ/g, 'd')
    .replace(/ć/g, 'c')
    .replace(/č/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ä/g, 'a')
    // Remove punctuation
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/-/g, ' ')
    // Remove suffixes
    .replace(/\s+(jr|sr|ii|iii|iv|v)\s*$/gi, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Match BallDontLie players with NBA Stats players
function matchPlayers(bdlPlayers, nbaPlayers) {
  console.log('🔄 Matching players by name...');
  
  const mappings = [];
  const nbaByName = new Map();
  
  // Index NBA players by normalized name
  nbaPlayers.forEach(player => {
    const normalized = normalizeName(player.name);
    nbaByName.set(normalized, player);
  });

  let matched = 0;
  let unmatched = 0;

  bdlPlayers.forEach(bdlPlayer => {
    const bdlName = `${bdlPlayer.first_name} ${bdlPlayer.last_name}`;
    const normalized = normalizeName(bdlName);
    
    const nbaPlayer = nbaByName.get(normalized);
    
    if (nbaPlayer) {
      mappings.push({
        bdlId: String(bdlPlayer.id),
        nbaId: nbaPlayer.id,
        name: bdlName,
      });
      matched++;
    } else {
      unmatched++;
      if (unmatched <= 10) {
        console.log(`  ⚠️  No match: ${bdlName} (BDL ID: ${bdlPlayer.id})`);
      }
    }
  });

  console.log(`✅ Matched ${matched} players`);
  console.log(`⚠️  Unmatched: ${unmatched} players\n`);
  
  return mappings;
}

// Generate TypeScript mapping file
function generateMappingFile(mappings) {
  console.log('📝 Generating mapping file...');
  
  const timestamp = new Date().toISOString();
  
  const content = `// lib/playerIdMapping.ts
// Auto-generated player ID mapping
// Generated: ${timestamp}
// Total mappings: ${mappings.length}

export interface PlayerIdMapping {
  bdlId: string;      // BallDontLie ID
  nbaId: string;      // NBA Stats API ID
  name: string;       // Player name for reference
}

// Complete player ID mappings (${mappings.length} players)
export const PLAYER_ID_MAPPINGS: PlayerIdMapping[] = [
${mappings.map(m => `  { bdlId: '${m.bdlId}', nbaId: '${m.nbaId}', name: '${m.name.replace(/'/g, "\\'")}' },`).join('\n')}
];

// Helper maps for quick lookups
const bdlToNbaMap = new Map<string, string>();
const nbaToBdlMap = new Map<string, string>();

PLAYER_ID_MAPPINGS.forEach(mapping => {
  bdlToNbaMap.set(mapping.bdlId, mapping.nbaId);
  nbaToBdlMap.set(mapping.nbaId, mapping.bdlId);
});

/**
 * Convert BallDontLie ID to NBA Stats ID
 */
export function convertBdlToNbaId(bdlId: string | number): string | null {
  const id = String(bdlId);
  return bdlToNbaMap.get(id) || null;
}

/**
 * Convert NBA Stats ID to BallDontLie ID
 */
export function convertNbaToBdlId(nbaId: string | number): string | null {
  const id = String(nbaId);
  return nbaToBdlMap.get(id) || null;
}

/**
 * Detect the type of ID (BallDontLie or NBA Stats)
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

/**
 * Alias for getNbaStatsId (for backwards compatibility)
 */
export const getNbaIdFromBdlId = getNbaStatsId;
`;

  const outputPath = path.join(__dirname, '..', 'lib', 'playerIdMapping.ts');
  fs.writeFileSync(outputPath, content, 'utf8');
  
  console.log(`✅ Written to: ${outputPath}\n`);
}

// Main execution
async function main() {
  console.log('🏀 Building Complete Player ID Mapping\n');
  console.log('This will fetch all players from both APIs and match them by name.\n');

  try {
    // Fetch from both APIs
    const [bdlPlayers, nbaPlayers] = await Promise.all([
      fetchBallDontLiePlayers(),
      fetchNBAStatsPlayers(),
    ]);

    if (bdlPlayers.length === 0 || nbaPlayers.length === 0) {
      throw new Error('Failed to fetch players from one or both APIs');
    }

    // Match players
    const mappings = matchPlayers(bdlPlayers, nbaPlayers);

    if (mappings.length === 0) {
      throw new Error('No players matched!');
    }

    // Generate file
    generateMappingFile(mappings);

    console.log('✅ Mapping complete!');
    console.log(`   Total mappings: ${mappings.length}`);
    console.log(`   Coverage: ${((mappings.length / bdlPlayers.length) * 100).toFixed(1)}%\n`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

