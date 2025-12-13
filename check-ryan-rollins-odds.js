// Quick script to check if Ryan Rollins has odds in BDL API
const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';

const RYAN_ROLLINS_PLAYER_ID = 38017712;

async function checkRyanRollinsOdds() {
  try {
    console.log('🔍 Checking BDL API for Ryan Rollins odds...');
    console.log(`Player ID: ${RYAN_ROLLINS_PLAYER_ID}`);
    console.log(`API Key present: ${!!apiKey}`);
    
    // First, get today's games to find which game Ryan Rollins might be in
    const today = new Date().toISOString().split('T')[0];
    console.log(`\n📅 Fetching games for today: ${today}`);
    
    const gamesResponse = await fetch(`https://api.balldontlie.io/v1/games?dates[]=${today}&per_page=100`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
      },
    });
    
    if (!gamesResponse.ok) {
      throw new Error(`Games API error: ${gamesResponse.status} ${gamesResponse.statusText}`);
    }
    
    const gamesData = await gamesResponse.json();
    const games = gamesData.data || [];
    console.log(`Found ${games.length} games today`);
    
    // Check player props for each game
    let foundProps = false;
    for (const game of games) {
      console.log(`\n🎮 Checking game ${game.id}: ${game.visitor_team?.abbreviation || game.visitor_team?.name} @ ${game.home_team?.abbreviation || game.home_team?.name}`);
      
      const propsResponse = await fetch(`https://api.balldontlie.io/v2/odds/player_props?game_id=${game.id}&player_id=${RYAN_ROLLINS_PLAYER_ID}&per_page=100`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': authHeader,
        },
      });
      
      if (!propsResponse.ok) {
        console.log(`  ⚠️  Props API error: ${propsResponse.status}`);
        continue;
      }
      
      const propsData = await propsResponse.json();
      const props = propsData.data || [];
      
      if (props.length > 0) {
        foundProps = true;
        console.log(`  ✅ Found ${props.length} props for Ryan Rollins!`);
        console.log(`  📊 Props breakdown:`);
        
        const propsByType = {};
        const propsByVendor = {};
        props.forEach(prop => {
          propsByType[prop.prop_type] = (propsByType[prop.prop_type] || 0) + 1;
          propsByVendor[prop.vendor] = (propsByVendor[prop.vendor] || 0) + 1;
        });
        
        console.log(`  Prop types:`, propsByType);
        console.log(`  Vendors:`, propsByVendor);
        console.log(`  Sample props (first 3):`);
        props.slice(0, 3).forEach(prop => {
          console.log(`    - ${prop.prop_type}: ${prop.line_value} (${prop.vendor})`);
        });
      } else {
        console.log(`  ❌ No props found for Ryan Rollins in this game`);
      }
    }
    
    if (!foundProps) {
      console.log(`\n❌ No player props found for Ryan Rollins (ID: ${RYAN_ROLLINS_PLAYER_ID}) in any of today's games`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

checkRyanRollinsOdds();

