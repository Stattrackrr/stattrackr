/**
 * Check what games actually happened on Dec 3
 */

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;
require('dotenv').config({ path: '.env.local' });

async function checkGames() {
  const date = '2025-12-03';
  console.log(`📊 Checking games on ${date}...\n`);
  
  const response = await fetch(
    `https://api.balldontlie.io/v1/games?dates[]=${date}`,
    {
      headers: {
        'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
      },
    }
  );
  
  const data = await response.json();
  const games = data.data || [];
  
  console.log(`Found ${games.length} games:\n`);
  
  games.forEach((game, i) => {
    console.log(`${i + 1}. ${game.home_team?.abbreviation || game.home_team?.full_name} vs ${game.visitor_team?.abbreviation || game.visitor_team?.full_name}`);
    console.log(`   Status: ${game.status}`);
    console.log(`   Score: ${game.home_team_score || 0} - ${game.visitor_team_score || 0}`);
    console.log(`   Game ID: ${game.id}`);
    console.log('');
  });
}

checkGames();

