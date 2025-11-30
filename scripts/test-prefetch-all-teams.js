require('dotenv').config({ path: '.env.local' });

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET;

async function testPrefetch() {
  try {
    console.log(`\n🧪 Testing prefetch-lineups for all teams`);
    console.log(`📡 Calling: ${PROD_URL}/api/cron/prefetch-lineups`);
    console.log(`\n📋 This will show which teams are being prefetched\n`);
    
    const url = `${PROD_URL}/api/cron/prefetch-lineups${CRON_SECRET ? `?secret=${CRON_SECRET}` : ''}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        ...(CRON_SECRET ? { 'Authorization': `Bearer ${CRON_SECRET}` } : {})
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Error:', data.error || response.statusText);
      process.exit(1);
    }
    
    console.log('✅ Response received:');
    console.log(`   - Games processed: ${data.gamesProcessed || 0}`);
    console.log(`   - Successful: ${data.successful || 0}`);
    console.log(`   - Locked (verified): ${data.locked || 0}`);
    console.log(`   - Projected: ${data.projected || 0}`);
    console.log(`   - Message: ${data.message || 'N/A'}`);
    
    // Count teams by date
    if (data.results && Array.isArray(data.results)) {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      const teamsToday = new Set();
      const teamsTomorrow = new Set();
      
      data.results.forEach(r => {
        if (r.date === today) {
          teamsToday.add(r.team);
        } else if (r.date === tomorrowStr) {
          teamsTomorrow.add(r.team);
        }
      });
      
      console.log(`\n📅 Games breakdown:`);
      console.log(`   - Teams playing TODAY (${today}): ${teamsToday.size} teams`);
      console.log(`   - Teams playing TOMORROW (${tomorrowStr}): ${teamsTomorrow.size} teams`);
      console.log(`   - Total unique teams: ${new Set([...teamsToday, ...teamsTomorrow]).size} teams`);
    }
    
    if (data.results && Array.isArray(data.results)) {
      console.log(`\n📊 Results for ${data.results.length} team-date pairs:`);
      
      // Group by team
      const byTeam = {};
      data.results.forEach(r => {
        if (!byTeam[r.team]) byTeam[r.team] = [];
        byTeam[r.team].push({
          date: r.date,
          success: r.success,
          isLocked: r.isLocked,
          verifiedCount: r.verifiedCount,
          message: r.message
        });
      });
      
      console.log(`\n📈 Teams being prefetched (${Object.keys(byTeam).length} teams):`);
      Object.keys(byTeam).sort().forEach(team => {
        const pairs = byTeam[team];
        const locked = pairs.filter(p => p.isLocked).length;
        const projected = pairs.filter(p => p.success && !p.isLocked).length;
        const failed = pairs.filter(p => !p.success);
        const failedCount = failed.length;
        console.log(`   ${team}: ${pairs.length} date(s) - ${locked} locked, ${projected} projected, ${failedCount} failed`);
        if (failedCount > 0) {
          failed.forEach(f => {
            console.log(`      ❌ ${f.date}: ${f.message}`);
            if (f.debugLogs && f.debugLogs.length > 0) {
              console.log(`         Debug: ${f.debugLogs.slice(-3).join(' | ')}`); // Show last 3 log entries
            }
          });
        }
      });
      
      // Check if we have all 30 teams
      const NBA_TEAMS = [
        'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
        'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
        'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
      ];
      
      const teamsWithGames = Object.keys(byTeam);
      const teamsWithoutGames = NBA_TEAMS.filter(t => !teamsWithGames.includes(t));
      
      if (teamsWithoutGames.length > 0) {
        console.log(`\n⚠️  Teams with no games today/tomorrow (${teamsWithoutGames.length}):`);
        console.log(`   ${teamsWithoutGames.join(', ')}`);
      } else {
        console.log(`\n✅ All 30 teams have games scheduled or were checked`);
      }
    }
    
    console.log(`\n✅ Prefetch test completed!`);
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    process.exit(1);
  }
}

testPrefetch();
