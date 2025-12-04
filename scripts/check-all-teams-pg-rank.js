/**
 * Check defensive rank vs Point Guards for all teams
 * 
 * Usage:
 *   node scripts/check-all-teams-pg-rank.js
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

const ALL_TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const TEAM_NAMES = {
  'ATL': 'Atlanta Hawks',
  'BOS': 'Boston Celtics',
  'BKN': 'Brooklyn Nets',
  'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls',
  'CLE': 'Cleveland Cavaliers',
  'DAL': 'Dallas Mavericks',
  'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons',
  'GSW': 'Golden State Warriors',
  'HOU': 'Houston Rockets',
  'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers',
  'LAL': 'Los Angeles Lakers',
  'MEM': 'Memphis Grizzlies',
  'MIA': 'Miami Heat',
  'MIL': 'Milwaukee Bucks',
  'MIN': 'Minnesota Timberwolves',
  'NOP': 'New Orleans Pelicans',
  'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder',
  'ORL': 'Orlando Magic',
  'PHI': 'Philadelphia 76ers',
  'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers',
  'SAC': 'Sacramento Kings',
  'SAS': 'San Antonio Spurs',
  'TOR': 'Toronto Raptors',
  'UTA': 'Utah Jazz',
  'WAS': 'Washington Wizards'
};

async function fetchPGRank() {
  try {
    const url = `${BASE_URL}/api/dvp/rank?metric=pts&pos=PG&games=82&season=2025`;
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching PG rank: ${error.message}`);
    return null;
  }
}

function formatRank(rank) {
  if (rank === null || rank === undefined) return 'N/A';
  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}

async function main() {
  console.log('🏀 Defensive Rankings vs Point Guards (Points)\n');
  console.log('Fetching data from API...\n');
  
  const data = await fetchPGRank();
  
  if (!data || !data.success) {
    console.error('❌ Failed to fetch rankings');
    if (data?.error) {
      console.error(`Error: ${data.error}`);
    }
    process.exit(1);
  }
  
  const rankings = data.rankings || [];
  
  if (rankings.length === 0) {
    console.log('⚠️  No rankings found');
    process.exit(1);
  }
  
  // Sort by rank (1 = best defense, 30 = worst defense)
  const sorted = [...rankings].sort((a, b) => {
    if (a.rank === null && b.rank === null) return 0;
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });
  
  console.log('Rank | Team | Points Allowed vs PG | Games');
  console.log('-----|------|---------------------|------');
  
  for (const team of sorted) {
    const teamName = TEAM_NAMES[team.team] || team.team;
    const rank = formatRank(team.rank);
    const value = team.value !== null && team.value !== undefined 
      ? team.value.toFixed(1) 
      : 'N/A';
    const games = team.games || 'N/A';
    
    console.log(`${rank.padEnd(4)} | ${team.team.padEnd(4)} | ${value.padEnd(20)} | ${games}`);
  }
  
  console.log('\n📊 Summary:');
  console.log(`   Total teams: ${rankings.length}`);
  console.log(`   Best defense: ${sorted[0]?.team} (${formatRank(sorted[0]?.rank)}) - ${sorted[0]?.value?.toFixed(1) || 'N/A'} pts/game`);
  console.log(`   Worst defense: ${sorted[sorted.length - 1]?.team} (${formatRank(sorted[sorted.length - 1]?.rank)}) - ${sorted[sorted.length - 1]?.value?.toFixed(1) || 'N/A'} pts/game`);
  
  // Show teams with missing data
  const missing = rankings.filter(r => r.value === null || r.rank === null);
  if (missing.length > 0) {
    console.log(`\n⚠️  Teams with missing data: ${missing.map(r => r.team).join(', ')}`);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

