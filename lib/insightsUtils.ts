// Shared insights utility - extracted from RightSidebar for reuse

export interface JournalBet {
  id: string;
  date: string;
  sport: string;
  market?: string;
  selection: string;
  stake: number;
  odds: number;
  result: 'win' | 'loss' | 'void' | 'pending';
  status?: 'pending' | 'live' | 'completed';
  currency: string;
  opponent?: string;
  team?: string;
  stat_type?: string | null;
  player_id?: string | null;
  player_name?: string | null;
  over_under?: 'over' | 'under' | null;
  line?: number | null;
  actual_value?: number | null;
  game_date?: string | null;
  parlay_legs?: Array<{
    playerName?: string;
    playerId?: string;
    statType?: string;
    overUnder?: 'over' | 'under';
    line?: number;
    won?: boolean | null;
  }> | null;
}

export interface Insight {
  id: string;
  type: 'loss' | 'win' | 'comparison' | 'streak' | 'neutral' | 'pain';
  category: 'stat' | 'player' | 'parlay' | 'over_under' | 'opponent' | 'bet_type';
  message: string;
  priority: number;
  color: 'red' | 'green' | 'yellow' | 'blue' | 'orange';
  stats?: {
    wins?: number;
    losses?: number;
    total?: number;
    winRate?: number;
    profit?: number;
    wagered?: number;
    returned?: number;
    roi?: number;
  };
  relatedBets?: JournalBet[];
  recommendation?: string;
  potentialProfit?: number;
}

// Helper function to check if bet is a parlay
function isParlay(bet: JournalBet): boolean {
  return bet.selection?.startsWith('Parlay:') || (bet.parlay_legs && bet.parlay_legs.length > 0) || false;
}

// Helper function to extract player name from bet
function getPlayerName(bet: JournalBet): string | null {
  if (bet.player_name) return bet.player_name;
  if (bet.selection && !isParlay(bet)) {
    const match = bet.selection.match(/^([^0-9]+?)\s+(over|under|Over|Under)/i);
    if (match) return match[1].trim();
  }
  return null;
}

// Helper function to format stat name for display
function formatStatName(stat: string): string {
  const statMap: Record<string, string> = {
    'pts': 'Points',
    'reb': 'Rebounds',
    'ast': 'Assists',
    'stl': 'Steals',
    'blk': 'Blocks',
    'fg3m': '3-Pointers Made',
    'pr': 'Points + Rebounds',
    'pra': 'Points + Rebounds + Assists',
    'ra': 'Rebounds + Assists',
    'pa': 'Points + Assists',
  };
  return statMap[stat.toLowerCase()] || stat.toUpperCase();
}

// Generate insights from journal bets
export function generateInsights(bets: JournalBet[]): Insight[] {
  const insights: Insight[] = [];
  const MIN_BETS_FOR_INSIGHTS = 10;
  
  const settledBets = bets.filter(b => b.result === 'win' || b.result === 'loss');
  
  if (settledBets.length < MIN_BETS_FOR_INSIGHTS) {
    return insights;
  }
  
  const parlayBets = settledBets.filter(isParlay);
  const straightBets = settledBets.filter(b => !isParlay(b));
  
  const getBetProfit = (bet: JournalBet): number => {
    if (bet.result === 'win') {
      return bet.stake * (bet.odds - 1);
    } else if (bet.result === 'loss') {
      return -bet.stake;
    }
    return 0;
  };
  
  const getTotalWagered = (betList: JournalBet[]): number => {
    return betList.reduce((sum, bet) => sum + bet.stake, 0);
  };
  
  const getTotalReturned = (betList: JournalBet[]): number => {
    return betList.reduce((sum, bet) => {
      if (bet.result === 'win') {
        return sum + (bet.stake * bet.odds);
      }
      return sum;
    }, 0);
  };
  
  // Simplified insights generation - just the key ones for mobile
  // By stat type + over/under
  const statOverUnderGroups: Record<string, Record<string, { wins: number; losses: number; bets: JournalBet[] }>> = {};
  straightBets.forEach(bet => {
    if (bet.stat_type && bet.over_under) {
      if (!statOverUnderGroups[bet.stat_type]) {
        statOverUnderGroups[bet.stat_type] = {};
      }
      if (!statOverUnderGroups[bet.stat_type][bet.over_under]) {
        statOverUnderGroups[bet.stat_type][bet.over_under] = { wins: 0, losses: 0, bets: [] };
      }
      if (bet.result === 'win') statOverUnderGroups[bet.stat_type][bet.over_under].wins++;
      else statOverUnderGroups[bet.stat_type][bet.over_under].losses++;
      statOverUnderGroups[bet.stat_type][bet.over_under].bets.push(bet);
    }
  });
  
  Object.entries(statOverUnderGroups).forEach(([stat, overUnderData]) => {
    Object.entries(overUnderData).forEach(([overUnder, data]) => {
      const total = data.wins + data.losses;
      if (total >= 3) {
        const winRate = Math.round((data.wins / total) * 100);
        const statName = formatStatName(stat);
        const overUnderLabel = overUnder.charAt(0).toUpperCase() + overUnder.slice(1);
        const wagered = getTotalWagered(data.bets);
        const returned = getTotalReturned(data.bets);
        const profit = returned - wagered;
        const roi = wagered > 0 ? Math.round((profit / wagered) * 100) : 0;
        
        if (winRate >= 60 && total >= 3) {
          insights.push({
            id: `stat-overunder-win-${stat}-${overUnder}`,
            type: 'win',
            category: 'stat',
            message: `${overUnderLabel} ${statName}: ${winRate}% win rate (${data.wins}W-${data.losses}L)`,
            priority: winRate * 10 + total * 5,
            color: 'green',
            stats: { wins: data.wins, losses: data.losses, total, winRate, profit, wagered, returned, roi },
            relatedBets: data.bets,
          });
        }
        if (winRate < 45 && total >= 3 && data.losses >= 2) {
          insights.push({
            id: `stat-overunder-loss-${stat}-${overUnder}`,
            type: 'loss',
            category: 'stat',
            message: `${overUnderLabel} ${statName}: ${winRate}% win rate (${data.wins}W-${data.losses}L)`,
            priority: data.losses * 15 + total * 5,
            color: 'red',
            stats: { wins: data.wins, losses: data.losses, total, winRate, profit, wagered, returned, roi },
            relatedBets: data.bets,
          });
        }
      }
    });
  });
  
  // By player
  const playerGroups: Record<string, { wins: number; losses: number; bets: JournalBet[] }> = {};
  straightBets.forEach(bet => {
    const playerName = getPlayerName(bet);
    if (playerName) {
      if (!playerGroups[playerName]) {
        playerGroups[playerName] = { wins: 0, losses: 0, bets: [] };
      }
      if (bet.result === 'win') playerGroups[playerName].wins++;
      else playerGroups[playerName].losses++;
      playerGroups[playerName].bets.push(bet);
    }
  });
  
  Object.entries(playerGroups).forEach(([player, data]) => {
    const total = data.wins + data.losses;
    if (total >= 3 && data.losses >= 2) {
      const lossRate = Math.round((data.losses / total) * 100);
      if (lossRate >= 40) {
        insights.push({
          id: `player-loss-${player}`,
          type: 'loss',
          category: 'player',
          message: `${player}: ${lossRate}% loss rate (${data.wins}W-${data.losses}L)`,
          priority: data.losses * 12 + total,
          color: 'red',
          stats: { wins: data.wins, losses: data.losses, total, winRate: Math.round((data.wins / total) * 100) },
          relatedBets: data.bets,
        });
      }
    }
    if (total >= 5 && data.wins >= 3) {
      const winRate = Math.round((data.wins / total) * 100);
      if (winRate >= 60) {
        insights.push({
          id: `player-win-${player}`,
          type: 'win',
          category: 'player',
          message: `${player}: ${winRate}% win rate (${data.wins}W-${data.losses}L)`,
          priority: winRate * 10 + total,
          color: 'green',
          stats: { wins: data.wins, losses: data.losses, total, winRate },
          relatedBets: data.bets,
        });
      }
    }
  });
  
  // Parlay insights
  if (parlayBets.length >= 3) {
    const parlayWins = parlayBets.filter(b => b.result === 'win').length;
    const parlayLosses = parlayBets.filter(b => b.result === 'loss').length;
    const parlayWinRate = Math.round((parlayWins / parlayBets.length) * 100);
    const parlayWagered = getTotalWagered(parlayBets);
    const parlayReturned = getTotalReturned(parlayBets);
    const parlayProfit = parlayReturned - parlayWagered;
    const parlayROI = parlayWagered > 0 ? Math.round((parlayProfit / parlayWagered) * 100) : 0;
    
    if (parlayLosses >= 2 && parlayLosses > parlayWins) {
      insights.push({
        id: 'parlay-loss',
        type: 'loss',
        category: 'parlay',
        message: `Parlays: ${parlayWinRate}% win rate (${parlayWins}W-${parlayLosses}L)`,
        priority: parlayLosses * 15,
        color: 'red',
        stats: { wins: parlayWins, losses: parlayLosses, total: parlayBets.length, winRate: parlayWinRate, profit: parlayProfit, wagered: parlayWagered, returned: parlayReturned, roi: parlayROI },
        relatedBets: parlayBets,
      });
    }
  }
  
  // Overall financial
  const totalWagered = getTotalWagered(settledBets);
  const totalReturned = getTotalReturned(settledBets);
  const totalProfit = totalReturned - totalWagered;
  const overallROI = totalWagered > 0 ? Math.round((totalProfit / totalWagered) * 100) : 0;
  
  if (settledBets.length >= 15 && totalWagered >= 100) {
    if (totalProfit < -50) {
      insights.push({
        id: 'overall-financial-loss',
        type: 'loss',
        category: 'bet_type',
        message: `Overall: ${overallROI}% ROI (${totalProfit < 0 ? '-' : '+'}$${Math.abs(totalProfit).toFixed(2)})`,
        priority: Math.abs(totalProfit) * 3,
        color: 'red',
      });
    } else if (totalProfit > 50) {
      insights.push({
        id: 'overall-financial-win',
        type: 'win',
        category: 'bet_type',
        message: `Overall: ${overallROI}% ROI (+$${totalProfit.toFixed(2)})`,
        priority: totalProfit * 3,
        color: 'green',
      });
    }
  }
  
  return insights.sort((a, b) => b.priority - a.priority).slice(0, 10);
}

