"use client";

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useTrackedBets } from "../contexts/TrackedBetsContext";
import { Plus, X, TrendingUp, History, Target, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { formatOdds } from "@/lib/currencyUtils";
import { StatTrackrLogoWithText } from "./StatTrackrLogo";
import { getEspnLogoUrl } from "@/lib/nbaAbbr";

interface JournalBet {
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
  parlay_legs?: Array<{
    playerName?: string;
    playerId?: string;
    statType?: string;
    overUnder?: 'over' | 'under';
    line?: number;
    won?: boolean | null;
  }> | null;
}

type TabType = 'tracked' | 'journal';

interface Insight {
  id: string;
  type: 'loss' | 'win' | 'comparison' | 'streak';
  category: 'stat' | 'player' | 'parlay' | 'over_under' | 'opponent' | 'bet_type';
  message: string;
  priority: number; // Higher = more important (for sorting)
  color: 'red' | 'green' | 'yellow' | 'blue';
}

// Helper function to check if bet is a parlay
function isParlay(bet: JournalBet): boolean {
  return bet.selection?.startsWith('Parlay:') || (bet.parlay_legs && bet.parlay_legs.length > 0) || false;
}

// Helper function to extract player name from bet
function getPlayerName(bet: JournalBet): string | null {
  if (bet.player_name) return bet.player_name;
  // Try to parse from selection text
  if (bet.selection && !isParlay(bet)) {
    // Pattern: "PlayerName Stat Over/Under Line"
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
  return statMap[stat.toLowerCase()] || stat.charAt(0).toUpperCase() + stat.slice(1).toLowerCase();
}

// Message templates with personality
const messageTemplates = {
  statOverUnderWin: [
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `${overUnder} ${stat} is your bread and butter - ${winRate}% success rate`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `Keep doing ${overUnder} ${stat}! You're hitting ${winRate}% (${wins}/${total})`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `${winRate}% (${wins}/${total}) of your bets on the ${overUnder} for ${stat} win`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `You win ${winRate}% of bets when you bet ${overUnder} on ${stat}`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `${overUnder} ${stat} bets are working for you - ${winRate}% win rate (${wins}/${total})`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `You win ${winRate}% of bets when you do ${overUnder} on ${stat} (${wins}/${total})`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `When you bet ${overUnder} on ${stat}, you win ${winRate}% of the time. Keep it up!`,
  ],
  statOverUnderLoss: [
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `Bruh, ${overUnder} ${stat} is killing you. Only ${winRate}% win rate (${wins}/${total})`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `Maybe stop betting ${overUnder} on ${stat}? You're only winning ${winRate}% of the time`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `${overUnder} ${stat} bets are rough - ${winRate}% success rate. Maybe try the opposite?`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `Only ${winRate}% (${wins}/${total}) of your bets on the ${overUnder} for ${stat} win`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `${overUnder} ${stat} bets aren't your thing - only ${winRate}% win rate (${wins}/${total})`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `${overUnder} ${stat} is not working out - ${winRate}% (${wins}/${total}) win rate`,
    (winRate: number, wins: number, total: number, overUnder: string, stat: string) => 
      `You're losing ${100 - winRate}% of your ${overUnder} ${stat} bets. That's not sustainable`,
  ],
  financialLoss: [
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `Bruh, you wagered $${wagered.toFixed(2)} on ${stat} but only got $${returned.toFixed(2)} back? Come on man, that's ${Math.abs(roi)}% down`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `What are you doing with ${stat}? $${wagered.toFixed(2)} in, $${returned.toFixed(2)} out. That's not it chief`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `In ${total} ${stat} bets you lost $${Math.abs(profit).toFixed(2)}. You wagered $${wagered.toFixed(2)} and only got $${returned.toFixed(2)} back`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `${stat} bets are bleeding money - $${wagered.toFixed(2)} wagered, $${returned.toFixed(2)} returned (${roi}% ROI)`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `${stat} straight bets: $${wagered.toFixed(2)} wagered, $${returned.toFixed(2)} returned. You're down $${Math.abs(profit).toFixed(2)} in ${total} bets`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `Oof, ${stat} is rough. In ${total} bets you lost $${Math.abs(profit).toFixed(2)} (${roi}% ROI)`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `You've put $${wagered.toFixed(2)} into ${stat} bets and only got $${returned.toFixed(2)} back. Time to rethink this?`,
  ],
  financialWin: [
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `${stat} are printing money for you. In ${total} bets you profited $${profit.toFixed(2)}. Keep it up!`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `${stat} is printing money for you - $${wagered.toFixed(2)} wagered, $${returned.toFixed(2)} returned (+${roi}% ROI)`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `In ${total} ${stat} bets you profited $${profit.toFixed(2)}. $${wagered.toFixed(2)} wagered, $${returned.toFixed(2)} returned. Keep it up!`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `Keep betting ${stat}! You're up $${profit.toFixed(2)} in ${total} bets (+${roi}% ROI)`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `${stat} is your money maker - $${profit.toFixed(2)} profit in ${total} bets (+${roi}% ROI)`,
    (wagered: number, returned: number, roi: number, stat: string, total: number, profit: number) => 
      `${stat} bets are working - $${returned.toFixed(2)} returned from $${wagered.toFixed(2)} wagered (+${roi}% ROI)`,
  ],
  comparison: [
    (difference: number, straightRate: number, parlayRate: number, better: string) => 
      `Your ${better} bet win percentage is ${difference}% better than your ${better === 'straight' ? 'parlay' : 'straight'} win % (${straightRate}% vs ${parlayRate}%)`,
    (difference: number, straightRate: number, parlayRate: number, better: string) => 
      `You perform ${difference}% better on ${better} bets (${straightRate}%) vs ${better === 'straight' ? 'parlays' : 'straight bets'} (${parlayRate}%)`,
    (difference: number, straightRate: number, parlayRate: number, better: string) => 
      `${better === 'straight' ? 'Straight' : 'Parlay'} bets are your thing - ${difference}% better win rate than ${better === 'straight' ? 'parlays' : 'straights'}`,
    (difference: number, straightRate: number, parlayRate: number, better: string) => 
      `Stick with ${better} bets! You're winning ${difference}% more often than ${better === 'straight' ? 'parlays' : 'straight bets'}`,
  ],
  overallFinancialLoss: [
    (wagered: number, returned: number, roi: number) => 
      `You've wagered $${wagered.toFixed(2)} in total and returned $${returned.toFixed(2)} (${roi}% ROI)`,
    (wagered: number, returned: number, roi: number) => 
      `Overall you're down $${Math.abs(returned - wagered).toFixed(2)} (${roi}% ROI). Time to reassess your strategy?`,
    (wagered: number, returned: number, roi: number) => 
      `You've lost $${Math.abs(returned - wagered).toFixed(2)} total (${roi}% ROI). Maybe take a step back and analyze your patterns`,
  ],
  overallFinancialWin: [
    (wagered: number, returned: number, roi: number) => 
      `You've wagered $${wagered.toFixed(2)} in total and returned $${returned.toFixed(2)} (+${roi}% ROI)`,
    (wagered: number, returned: number, roi: number) => 
      `You're up $${(returned - wagered).toFixed(2)} overall (+${roi}% ROI). Keep it up!`,
    (wagered: number, returned: number, roi: number) => 
      `Overall performance: +$${(returned - wagered).toFixed(2)} profit (+${roi}% ROI). Nice work!`,
  ],
  playerWin: [
    (winRate: number, wins: number, total: number, player: string) => 
      `You win ${winRate}% (${wins}/${total}) on ${player}`,
    (winRate: number, wins: number, total: number, player: string) => 
      `${player} is your guy - ${winRate}% win rate (${wins}/${total})`,
    (winRate: number, wins: number, total: number, player: string) => 
      `You're crushing it with ${player} - ${winRate}% (${wins}/${total}) win rate`,
    (winRate: number, wins: number, total: number, player: string) => 
      `${player} bets are printing money - ${winRate}% success rate (${wins}/${total})`,
  ],
  playerLoss: [
    (losses: number, total: number, lossRate: number, player: string) => 
      `You lose ${losses} out of ${total} bets on ${player} (${lossRate}% loss rate)`,
    (losses: number, total: number, lossRate: number, player: string) => 
      `${player} is not your friend - ${losses} losses out of ${total} bets (${lossRate}% loss rate)`,
    (losses: number, total: number, lossRate: number, player: string) => 
      `Bruh, ${player} is killing you. ${losses} losses out of ${total} bets`,
    (losses: number, total: number, lossRate: number, player: string) => 
      `Maybe stop betting on ${player}? You're losing ${lossRate}% of the time (${losses}/${total})`,
  ],
  statLossCount: [
    (losses: number, total: number, lossRate: number, stat: string) => 
      `You lose ${losses} out of ${total} bets on ${stat} (${lossRate}% loss rate)`,
    (losses: number, total: number, lossRate: number, stat: string) => 
      `${stat} is rough - ${losses} losses out of ${total} bets (${lossRate}% loss rate)`,
    (losses: number, total: number, lossRate: number, stat: string) => 
      `You're losing ${lossRate}% of your ${stat} bets (${losses}/${total}). Time to reassess?`,
  ],
  overUnderWin: [
    (wins: number, losses: number, winRate: number, type: string) => 
      `You're ${wins}-${losses} on ${type} bets (${winRate}% win rate)`,
    (wins: number, losses: number, winRate: number, type: string) => 
      `${type} bets are working - ${wins}-${losses} record (${winRate}% win rate)`,
    (wins: number, losses: number, winRate: number, type: string) => 
      `Keep betting ${type}! You're ${wins}-${losses} (${winRate}% win rate)`,
  ],
  overUnderLoss: [
    (losses: number, wins: number, winRate: number, type: string) => 
      `You're ${losses}-${wins} on ${type} bets (${winRate}% win rate)`,
    (losses: number, wins: number, winRate: number, type: string) => 
      `${type} bets aren't working - ${losses}-${wins} record (${winRate}% win rate)`,
    (losses: number, wins: number, winRate: number, type: string) => 
      `Maybe stop betting ${type}? You're ${losses}-${wins} (${winRate}% win rate)`,
  ],
  parlayLoss: [
    (losses: number, total: number) => 
      `You lose ${losses} out of ${total} parlays`,
    (losses: number, total: number) => 
      `Parlays are rough - ${losses} losses out of ${total} bets`,
    (losses: number, total: number) => 
      `Bruh, parlays aren't it. You lost ${losses} out of ${total}`,
    (losses: number, total: number) => 
      `Maybe stick to straight bets? You lost ${losses} out of ${total} parlays`,
  ],
};

// Helper to get deterministic message from template (based on insight ID for stability)
function getDeterministicMessage(insightId: string, templateKey: keyof typeof messageTemplates, ...args: any[]): string {
  const templates = messageTemplates[templateKey];
  // Use insight ID to deterministically select a message (stable across refreshes)
  let hash = 0;
  for (let i = 0; i < insightId.length; i++) {
    hash = ((hash << 5) - hash) + insightId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % templates.length;
  return templates[index](...args);
}

// Generate insights from journal bets
function generateInsights(bets: JournalBet[]): Insight[] {
  const insights: Insight[] = [];
  const MIN_BETS_FOR_INSIGHTS = 10;
  
  // Filter to only settled bets (win/loss, not pending/void)
  const settledBets = bets.filter(b => b.result === 'win' || b.result === 'loss');
  
  if (settledBets.length < MIN_BETS_FOR_INSIGHTS) {
    return insights; // Not enough data
  }
  
  // Separate parlay vs straight bets
  const parlayBets = settledBets.filter(isParlay);
  const straightBets = settledBets.filter(b => !isParlay(b));
  
  // Helper to calculate profit/loss for a bet
  const getBetProfit = (bet: JournalBet): number => {
    if (bet.result === 'win') {
      return bet.stake * (bet.odds - 1);
    } else if (bet.result === 'loss') {
      return -bet.stake;
    }
    return 0;
  };
  
  // Helper to calculate total wagered
  const getTotalWagered = (betList: JournalBet[]): number => {
    return betList.reduce((sum, bet) => sum + bet.stake, 0);
  };
  
  // Helper to calculate total returned
  const getTotalReturned = (betList: JournalBet[]): number => {
    return betList.reduce((sum, bet) => {
      if (bet.result === 'win') {
        return sum + (bet.stake * bet.odds);
      }
      return sum;
    }, 0);
  };
  
  // === STRAIGHT BET INSIGHTS ===
  
  // By stat type + over/under combination (e.g., "OVER for Rebounds")
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
  
  // Generate insights for stat + over/under combinations
  Object.entries(statOverUnderGroups).forEach(([stat, overUnderData]) => {
    Object.entries(overUnderData).forEach(([overUnder, data]) => {
      const total = data.wins + data.losses;
      if (total >= 3) {
        const winRate = Math.round((data.wins / total) * 100);
        const statName = formatStatName(stat);
        const overUnderLabel = overUnder.charAt(0).toUpperCase() + overUnder.slice(1);
        
        // High win rate insight
        if (winRate >= 60 && total >= 3) {
          insights.push({
            id: `stat-overunder-win-${stat}-${overUnder}`,
            type: 'win',
            category: 'stat',
            message: getDeterministicMessage(`stat-overunder-win-${stat}-${overUnder}`, 'statOverUnderWin', winRate, data.wins, total, overUnderLabel, statName),
            priority: winRate * 10 + total * 5,
            color: 'green',
          });
        }
        // Low win rate insight - lowered thresholds to show more losses
        if (winRate < 50 && total >= 3 && data.losses >= 2) {
          insights.push({
            id: `stat-overunder-loss-${stat}-${overUnder}`,
            type: 'loss',
            category: 'stat',
            message: getDeterministicMessage(`stat-overunder-loss-${stat}-${overUnder}`, 'statOverUnderLoss', winRate, data.wins, total, overUnderLabel, statName),
            priority: data.losses * 15 + total * 5,
            color: 'red',
          });
        }
      }
    });
  });
  
  // By stat type (overall)
  const statGroups: Record<string, { wins: number; losses: number; bets: JournalBet[]; wagered: number; returned: number }> = {};
  straightBets.forEach(bet => {
    if (bet.stat_type) {
      if (!statGroups[bet.stat_type]) {
        statGroups[bet.stat_type] = { wins: 0, losses: 0, bets: [], wagered: 0, returned: 0 };
      }
      if (bet.result === 'win') statGroups[bet.stat_type].wins++;
      else statGroups[bet.stat_type].losses++;
      statGroups[bet.stat_type].bets.push(bet);
      statGroups[bet.stat_type].wagered += bet.stake;
      if (bet.result === 'win') {
        statGroups[bet.stat_type].returned += bet.stake * bet.odds;
      }
    }
  });
  
  // Financial insights by stat
  Object.entries(statGroups).forEach(([stat, data]) => {
    const total = data.wins + data.losses;
    if (total >= 5 && data.wagered >= 50) {
      const statName = formatStatName(stat);
      const profit = data.returned - data.wagered;
      const roi = Math.round((profit / data.wagered) * 100);
      
      // Negative ROI insight - lowered threshold to show more losses
      if (profit < 0 && Math.abs(profit) >= 10) {
        insights.push({
          id: `stat-financial-loss-${stat}`,
          type: 'loss',
          category: 'stat',
          message: getDeterministicMessage(`stat-financial-loss-${stat}`, 'financialLoss', data.wagered, data.returned, roi, statName, total, profit),
          priority: Math.abs(profit) * 3 + total * 3 + data.losses * 5,
          color: 'red',
        });
      }
      // Positive ROI insight
      if (profit > 0 && profit >= 20) {
        insights.push({
          id: `stat-financial-win-${stat}`,
          type: 'win',
          category: 'stat',
          message: getDeterministicMessage(`stat-financial-win-${stat}`, 'financialWin', data.wagered, data.returned, roi, statName, total, profit),
          priority: profit * 2 + total * 3,
          color: 'green',
        });
      }
      
      // Also show loss insights for stats with many losses even if ROI isn't terrible
      if (data.losses >= 4 && total >= 6) {
        const lossRate = Math.round((data.losses / total) * 100);
        if (lossRate >= 40) {
          insights.push({
            id: `stat-loss-count-${stat}`,
            type: 'loss',
            category: 'stat',
            message: getDeterministicMessage(`stat-loss-count-${stat}`, 'statLossCount', data.losses, total, lossRate, statName),
            priority: data.losses * 12 + total * 3,
            color: 'red',
          });
        }
      }
    }
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
  
  // Find worst player (most losses) - lowered threshold
  Object.entries(playerGroups).forEach(([player, data]) => {
    const total = data.wins + data.losses;
    if (total >= 3 && data.losses >= 2) {
      const lossRate = Math.round((data.losses / total) * 100);
      // Show if loss rate is 40% or more
      if (lossRate >= 40) {
        insights.push({
          id: `player-loss-${player}`,
          type: 'loss',
          category: 'player',
          message: getDeterministicMessage(`player-loss-${player}`, 'playerLoss', data.losses, total, lossRate, player),
          priority: data.losses * 12 + total,
          color: 'red',
        });
      }
    }
    // Find best player (high win rate)
    if (total >= 5 && data.wins >= 3) {
      const winRate = Math.round((data.wins / total) * 100);
      if (winRate >= 60) {
        insights.push({
          id: `player-win-${player}`,
          type: 'win',
          category: 'player',
          message: getDeterministicMessage(`player-win-${player}`, 'playerWin', winRate, data.wins, total, player),
          priority: winRate * 10 + total,
          color: 'green',
        });
      }
    }
  });
  
  // By over/under - lowered thresholds
  const overBets = straightBets.filter(b => b.over_under === 'over');
  const underBets = straightBets.filter(b => b.over_under === 'under');
  
  if (overBets.length >= 4) {
    const overWins = overBets.filter(b => b.result === 'win').length;
    const overLosses = overBets.filter(b => b.result === 'loss').length;
    const overWinRate = Math.round((overWins / overBets.length) * 100);
    // Only show as loss if win rate is below 50% (actually losing)
    if (overLosses > overWins && overWinRate < 50) {
      insights.push({
        id: 'over-loss',
        type: 'loss',
        category: 'over_under',
        message: getDeterministicMessage('over-loss', 'overUnderLoss', overLosses, overWins, overWinRate, 'Over'),
        priority: overLosses * 12,
        color: 'red',
      });
    } else if (overWins > overLosses && overWinRate >= 60) {
      // Show as win if win rate is 60% or higher
      insights.push({
        id: 'over-win',
        type: 'win',
        category: 'over_under',
        message: getDeterministicMessage('over-win', 'overUnderWin', overWins, overLosses, overWinRate, 'Over'),
        priority: overWins * 10,
        color: 'green',
      });
    }
  }
  
  if (underBets.length >= 4) {
    const underWins = underBets.filter(b => b.result === 'win').length;
    const underLosses = underBets.filter(b => b.result === 'loss').length;
    const underWinRate = Math.round((underWins / underBets.length) * 100);
    // Only show as loss if win rate is below 50% (actually losing)
    if (underLosses > underWins && underWinRate < 50) {
      insights.push({
        id: 'under-loss',
        type: 'loss',
        category: 'over_under',
        message: getDeterministicMessage('under-loss', 'overUnderLoss', underLosses, underWins, underWinRate, 'Under'),
        priority: underLosses * 12,
        color: 'red',
      });
    } else if (underWins > underLosses && underWinRate >= 60) {
      // Show as win if win rate is 60% or higher
      insights.push({
        id: 'under-win',
        type: 'win',
        category: 'over_under',
        message: getDeterministicMessage('under-win', 'overUnderWin', underWins, underLosses, underWinRate, 'Under'),
        priority: underWins * 10,
        color: 'green',
      });
    }
  }
  
  // === PARLAY INSIGHTS ===
  
  if (parlayBets.length >= 3) {
    const parlayWins = parlayBets.filter(b => b.result === 'win').length;
    const parlayLosses = parlayBets.filter(b => b.result === 'loss').length;
    const parlayWinRate = Math.round((parlayWins / parlayBets.length) * 100);
    
    if (parlayLosses >= 2 && parlayLosses > parlayWins) {
      insights.push({
        id: 'parlay-loss',
        type: 'loss',
        category: 'parlay',
        message: getDeterministicMessage('parlay-loss', 'parlayLoss', parlayLosses, parlayBets.length),
        priority: parlayLosses * 15,
        color: 'red',
      });
    }
    
    // Analyze parlay legs by stat
    const parlayStatGroups: Record<string, { wins: number; losses: number }> = {};
    parlayBets.forEach(bet => {
      if (bet.parlay_legs) {
        bet.parlay_legs.forEach(leg => {
          if (leg.statType && leg.won !== null && leg.won !== undefined) {
            if (!parlayStatGroups[leg.statType]) {
              parlayStatGroups[leg.statType] = { wins: 0, losses: 0 };
            }
            if (leg.won) parlayStatGroups[leg.statType].wins++;
            else parlayStatGroups[leg.statType].losses++;
          }
        });
      }
    });
    
    Object.entries(parlayStatGroups).forEach(([stat, data]) => {
      const total = data.wins + data.losses;
      if (total >= 5 && data.losses >= 3) {
        const statName = formatStatName(stat);
        insights.push({
          id: `parlay-stat-loss-${stat}`,
          type: 'loss',
          category: 'parlay',
          message: `Your parlay legs on ${statName} lose ${data.losses} out of ${total}`,
          priority: data.losses * 8 + total,
          color: 'red',
        });
      }
    });
  }
  
  // === COMPARISON INSIGHTS ===
  
  if (straightBets.length >= 5 && parlayBets.length >= 3) {
    const straightWins = straightBets.filter(b => b.result === 'win').length;
    const straightWinRate = Math.round((straightWins / straightBets.length) * 100);
    const parlayWins = parlayBets.filter(b => b.result === 'win').length;
    const parlayWinRate = Math.round((parlayWins / parlayBets.length) * 100);
    const difference = Math.abs(straightWinRate - parlayWinRate);
    
    if (difference >= 10) {
      if (straightWinRate > parlayWinRate) {
        insights.push({
          id: 'comparison-straight-better',
          type: 'comparison',
          category: 'bet_type',
          message: getDeterministicMessage('comparison-straight-better', 'comparison', difference, straightWinRate, parlayWinRate, 'straight'),
          priority: difference * 10 + straightBets.length + parlayBets.length,
          color: 'blue',
        });
      } else {
        insights.push({
          id: 'comparison-parlay-better',
          type: 'comparison',
          category: 'bet_type',
          message: getDeterministicMessage('comparison-parlay-better', 'comparison', difference, straightWinRate, parlayWinRate, 'parlay'),
          priority: difference * 10 + straightBets.length + parlayBets.length,
          color: 'blue',
        });
      }
    }
  }
  
  // === ADDITIONAL FINANCIAL INSIGHTS ===
  
  // Overall financial performance
  const totalWagered = getTotalWagered(settledBets);
  const totalReturned = getTotalReturned(settledBets);
  const totalProfit = totalReturned - totalWagered;
  const overallROI = Math.round((totalProfit / totalWagered) * 100);
  
  if (settledBets.length >= 15 && totalWagered >= 100) {
    if (totalProfit < -50) {
      insights.push({
        id: 'overall-financial-loss',
        type: 'loss',
        category: 'bet_type',
        message: getDeterministicMessage('overall-financial-loss', 'overallFinancialLoss', totalWagered, totalReturned, overallROI),
        priority: Math.abs(totalProfit) * 3,
        color: 'red',
      });
    } else if (totalProfit > 50) {
      insights.push({
        id: 'overall-financial-win',
        type: 'win',
        category: 'bet_type',
        message: getDeterministicMessage('overall-financial-win', 'overallFinancialWin', totalWagered, totalReturned, overallROI),
        priority: totalProfit * 3,
        color: 'green',
      });
    }
  }
  
  // Sort by priority (highest first)
  const sortedInsights = insights.sort((a, b) => b.priority - a.priority);
  
  // Separate insights by color
  const redInsights = sortedInsights.filter(i => i.color === 'red');
  const blueInsights = sortedInsights.filter(i => i.color === 'blue');
  const greenInsights = sortedInsights.filter(i => i.color === 'green');
  const yellowInsights = sortedInsights.filter(i => i.color === 'yellow');
  
  // Strategy: Round-robin selection to ensure good color distribution
  const finalInsights: Insight[] = [];
  const usedIds = new Set<string>();
  
  const addInsight = (insight: Insight) => {
    if (!usedIds.has(insight.id) && finalInsights.length < 15) {
      finalInsights.push(insight);
      usedIds.add(insight.id);
    }
  };
  
  // Ensure we have at least 2 of each important color (if available)
  const guaranteedRed = redInsights.slice(0, Math.min(2, redInsights.length));
  const guaranteedBlue = blueInsights.slice(0, Math.min(2, blueInsights.length));
  const guaranteedGreen = greenInsights.slice(0, Math.min(2, greenInsights.length));
  
  // Get remaining insights (after guaranteed ones)
  const remainingRed = redInsights.slice(guaranteedRed.length);
  const remainingBlue = blueInsights.slice(guaranteedBlue.length);
  const remainingGreen = greenInsights.slice(guaranteedGreen.length);
  
  // Create color groups with all insights (guaranteed + remaining)
  const colorGroups: Array<{ color: string; insights: Insight[] }> = [
    { color: 'red', insights: [...guaranteedRed, ...remainingRed] },
    { color: 'green', insights: [...guaranteedGreen, ...remainingGreen] },
    { color: 'blue', insights: [...guaranteedBlue, ...remainingBlue] },
    { color: 'yellow', insights: yellowInsights }
  ].filter(group => group.insights.length > 0);
  
  // Create deterministic seed from all insight IDs
  let seed = 0;
  sortedInsights.forEach(insight => {
    for (let i = 0; i < insight.id.length; i++) {
      seed = ((seed << 5) - seed) + insight.id.charCodeAt(i);
      seed = seed & seed;
    }
  });
  
  // Shuffle color group order deterministically
  const shuffledColorGroups = [...colorGroups];
  for (let i = shuffledColorGroups.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = Math.abs(seed) % (i + 1);
    [shuffledColorGroups[i], shuffledColorGroups[j]] = [shuffledColorGroups[j], shuffledColorGroups[i]];
  }
  
  // Round-robin selection: interleave insights by color
  const colorIndices = new Map<string, number>();
  shuffledColorGroups.forEach(group => {
    colorIndices.set(group.color, 0);
  });
  
  let maxRounds = 0;
  shuffledColorGroups.forEach(group => {
    maxRounds = Math.max(maxRounds, group.insights.length);
  });
  
  // Interleave by taking one from each color group in round-robin fashion
  for (let round = 0; round < maxRounds && finalInsights.length < 15; round++) {
    // Shuffle the order we check colors each round (for better distribution)
    const roundColorOrder = [...shuffledColorGroups];
    for (let i = roundColorOrder.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = Math.abs(seed) % (i + 1);
      [roundColorOrder[i], roundColorOrder[j]] = [roundColorOrder[j], roundColorOrder[i]];
    }
    
    // Take one insight from each color group in this round
    for (const group of roundColorOrder) {
      if (finalInsights.length >= 15) break;
      
      const index = colorIndices.get(group.color) || 0;
      if (index < group.insights.length) {
        addInsight(group.insights[index]);
        colorIndices.set(group.color, index + 1);
      }
    }
  }
  
  // Final shuffle to break up any remaining patterns
  // Use a more aggressive shuffle that prevents adjacent similar colors
  const finalShuffled: Insight[] = [];
  const remaining = [...finalInsights];
  
  // Enhanced shuffle: avoid placing same color next to each other when possible
  while (remaining.length > 0) {
    if (finalShuffled.length === 0) {
      // First item: pick randomly
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const firstIndex = Math.abs(seed) % remaining.length;
      finalShuffled.push(remaining.splice(firstIndex, 1)[0]);
    } else {
      // Find items with different color than last item
      const lastColor = finalShuffled[finalShuffled.length - 1].color;
      const differentColor = remaining.filter(i => i.color !== lastColor);
      const sameColor = remaining.filter(i => i.color === lastColor);
      
      // Prefer different color, but allow same if needed
      const candidates = differentColor.length > 0 ? differentColor : sameColor;
      
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const candidateIndex = Math.abs(seed) % candidates.length;
      const selected = candidates[candidateIndex];
      
      // Remove from remaining
      const indexInRemaining = remaining.indexOf(selected);
      finalShuffled.push(remaining.splice(indexInRemaining, 1)[0]);
    }
  }
  
  return finalShuffled;
}

interface RightSidebarProps {
  oddsFormat?: 'american' | 'decimal';
  isMobileView?: boolean;
  showProfileIcon?: boolean;
  avatarUrl?: string | null;
  username?: string | null;
  userEmail?: string | null;
  isPro?: boolean;
  onProfileMenuClick?: () => void;
  showProfileMenu?: boolean;
  profileMenuRef?: React.RefObject<HTMLDivElement | null>;
  onSubscriptionClick?: () => void;
  onSignOutClick?: () => void;
}

export default function RightSidebar({ 
  oddsFormat = 'decimal', 
  isMobileView = false,
  showProfileIcon = false,
  avatarUrl = null,
  username = null,
  userEmail = null,
  isPro = false,
  onProfileMenuClick,
  showProfileMenu = false,
  profileMenuRef,
  onSubscriptionClick,
  onSignOutClick
}: RightSidebarProps = {}) {
  // Generate a consistent random color based on user's name/email
  const getAvatarColor = (name: string): string => {
    // Use a hash of the name to generate a consistent color
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Generate a vibrant color (avoid too light or too dark)
    const hue = Math.abs(hash) % 360;
    const saturation = 65 + (Math.abs(hash) % 20); // 65-85% saturation
    const lightness = 45 + (Math.abs(hash) % 15); // 45-60% lightness
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };
  
  const displayName = username || userEmail || 'User';
  const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'U';
  const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;
  const { isDark } = useTheme();
  const { trackedBets, removeTrackedBet, clearAllTrackedBets, refreshTrackedBets } = useTrackedBets();
  const [activeTab, setActiveTab] = useState<TabType>('journal');
  const [journalBets, setJournalBets] = useState<JournalBet[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmRemoveJournalId, setConfirmRemoveJournalId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedStat, setSelectedStat] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('all');
  const [selectedBookmaker, setSelectedBookmaker] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [advancedTeamDropdownOpen, setAdvancedTeamDropdownOpen] = useState(false);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const PROPS_PER_PAGE = 15;

  // Handle image loading errors
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>, team: string) => {
    setImageErrors(prev => new Set(prev).add(team));
    // Hide the image if it fails to load
    e.currentTarget.style.display = 'none';
  };

  // Stat options for filtering
  const STAT_OPTIONS = [
    { value: 'all', label: 'All Stats' },
    { value: 'pts', label: 'Points' },
    { value: 'reb', label: 'Rebounds' },
    { value: 'ast', label: 'Assists' },
    { value: 'pr', label: 'Points + Rebounds' },
    { value: 'pra', label: 'Points + Rebounds + Assists' },
    { value: 'ra', label: 'Rebounds + Assists' },
    { value: 'stl', label: 'Steals' },
    { value: 'blk', label: 'Blocks' },
    { value: 'fg3m', label: '3-Pointers Made' },
  ];

  // Timeframe options
  const TIMEFRAME_OPTIONS = [
    { value: 'all', label: 'All Time' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
  ];

  // Bookmaker options
  const BOOKMAKER_OPTIONS = [
    'DraftKings',
    'FanDuel',
    'BetMGM',
    'Caesars',
    'BetRivers',
    'PointsBet',
    'Bet365',
    'Manual Entry'
  ];

  // NBA team abbreviation to full name mapping
  const TEAM_ABBREVIATIONS: Record<string, string> = {
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
    'WAS': 'Washington Wizards',
  };

  // All NBA teams (full names)
  const ALL_NBA_TEAMS = Object.values(TEAM_ABBREVIATIONS).sort();

  // Prevent hydration mismatch by waiting for client mount
  useEffect(() => {
    setIsMounted(true);
    // Always show journal tab
    setActiveTab('journal');
    // Load tracked bets from Supabase on mount
    handleRefresh();
  }, []);

  // Save tab preference when it changes
  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('rightSidebar.activeTab', activeTab);
    }
  }, [activeTab, isMounted]);

  // Debug: Log when trackedBets changes
  useEffect(() => {
    console.log('RightSidebar: trackedBets updated:', trackedBets);
  }, [trackedBets]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    
    try {
      // First, trigger the check-tracked-bets API to update any completed games
      await fetch('/api/check-bets', {
        credentials: 'include', // Include cookies for authentication
      });
    } catch (error) {
      console.error('Failed to check tracked bets:', error);
      // Continue anyway to fetch current data
    }
    
    // Fetch tracked bets from Supabase
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsRefreshing(false);
      return;
    }

    const { data: trackedProps, error } = await (supabase
      .from('tracked_props') as any)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch tracked props:', error);
      setIsRefreshing(false);
      return;
    }

    if (trackedProps) {
      // Convert to TrackedBet format
      const bets = (trackedProps as any[]).map((prop: any) => {
        // Format stat type name for display
        const statDisplay = formatStatTypeName(prop.stat_type);
        
        return {
          id: prop.id,
          selection: `${prop.player_name} ${statDisplay} ${prop.over_under === 'over' ? 'Over' : 'Under'} ${prop.line}`,
          stake: 0,
          odds: prop.odds || 0,
          sport: 'NBA',
          playerName: prop.player_name,
          stat: prop.stat_type,
          line: prop.line,
          bookmaker: prop.bookmaker || null,
          isCustom: !prop.bookmaker, // If no bookmaker, it's custom
          gameStatus: prop.status === 'void' ? 'void' as const : prop.status === 'completed' ? 'completed' as const : prop.status === 'live' ? 'live' as const : 'scheduled' as const,
          result: prop.status === 'void' ? 'void' as const : prop.result || 'pending' as const,
          gameDate: prop.game_date,
          team: prop.team,
          opponent: prop.opponent,
          actualValue: prop.actual_value,
          actualPts: prop.actual_pts,
          actualReb: prop.actual_reb,
          actualAst: prop.actual_ast,
          actualStl: prop.actual_stl,
          actualBlk: prop.actual_blk,
          actualFg3m: prop.actual_fg3m,
        };
      });

      // Update context
      localStorage.setItem('trackedBets', JSON.stringify(bets));
      refreshTrackedBets();
    }
    
    setIsRefreshing(false);
  };

  // Fetch journal bets from Supabase
  // Note: check-journal-bets is handled by cron workflow (runs every 15 mins)
  // No need to trigger it on every refresh - reduces database load
  const fetchJournalBets = async () => {
    setIsRefreshing(true);
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsRefreshing(false);
      return;
    }

    const { data, error } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false });

    if (error) {
      console.error('Failed to fetch journal bets:', error);
      setIsRefreshing(false);
      return;
    }

    if (data) {
      setJournalBets(data);
    }
    
    setIsRefreshing(false);
  };

  // Load journal bets on mount and when tab changes to journal
  useEffect(() => {
    if (isMounted) {
      fetchJournalBets();
    }
  }, [isMounted, activeTab]); // Also reload when switching to journal tab

  const removeBet = async (id: string) => {
    // Remove from Supabase
    const { error } = await (supabase
      .from('tracked_props') as any)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete tracked prop:', error);
    }

    // Remove from context/localStorage
    removeTrackedBet(id);
    setConfirmRemoveId(null);
  };

  const removeJournalBet = async (id: string) => {
    // Remove from Supabase
    const { error } = await supabase
      .from('bets')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete journal bet:', error);
      alert('Failed to delete bet');
      return;
    }

    // Update local state
    setJournalBets((prev) => prev.filter((b) => b.id !== id));
    setConfirmRemoveJournalId(null);
  };

  const clearAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Delete all from Supabase
    const { error } = await (supabase
      .from('tracked_props') as any)
      .delete()
      .eq('user_id', user.id);

    if (error) {
      console.error('Failed to clear tracked props:', error);
    }

    // Clear from context/localStorage
    clearAllTrackedBets();
    setConfirmClearAll(false);
  };

  // Helper function to format stat type display name
  const formatStatTypeName = (statType: string) => {
    const type = statType.toLowerCase();
    switch (type) {
      case 'pts': return 'Points';
      case 'reb': return 'Rebounds';
      case 'ast': return 'Assists';
      case 'stl': return 'Steals';
      case 'blk': return 'Blocks';
      case 'fg3m': return '3PM';
      // Keep combined stats as abbreviations
      case 'pra': return 'PRA';
      case 'pr': return 'PR';
      case 'ra': return 'RA';
      case 'pa': return 'PA';
      default: return statType.toUpperCase();
    }
  };

  // Helper function to format stat breakdown for combined stats
  const formatStatBreakdown = (bet: any) => {
    if (!bet.stat || bet.actualValue === undefined) return null;

    const statType = bet.stat.toLowerCase();

    // For combined stats, show the breakdown
    if (statType === 'pra' && bet.actualPts !== undefined && bet.actualReb !== undefined && bet.actualAst !== undefined) {
      return `${bet.actualPts} PTS, ${bet.actualReb} REB, ${bet.actualAst} AST (${bet.actualValue})`;
    }
    if (statType === 'pr' && bet.actualPts !== undefined && bet.actualReb !== undefined) {
      return `${bet.actualPts} PTS, ${bet.actualReb} REB (${bet.actualValue})`;
    }
    if (statType === 'ra' && bet.actualReb !== undefined && bet.actualAst !== undefined) {
      return `${bet.actualReb} REB, ${bet.actualAst} AST (${bet.actualValue})`;
    }

    // For single stats, just show the value and stat type
    return `${bet.actualValue} ${bet.stat.toUpperCase()}`;
  };

  // Filter bets by timeframe
  const timeframeFilteredBets = useMemo(() => {
    if (selectedTimeframe === 'all') return trackedBets;
    
    const now = new Date();
    const daysAgo = selectedTimeframe === '7d' ? 7 : selectedTimeframe === '30d' ? 30 : 90;
    const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    
    return trackedBets.filter(bet => {
      if (!bet.gameDate) return true;
      const betDate = new Date(bet.gameDate);
      return betDate >= cutoffDate;
    });
  }, [trackedBets, selectedTimeframe]);

  // Get prop counts for opponent teams that have props (keep abbreviations)
  const teamPropCounts = useMemo(() => {
    const teamMap = new Map<string, number>();
    timeframeFilteredBets.forEach(bet => {
      if (bet.opponent) {
        teamMap.set(bet.opponent, (teamMap.get(bet.opponent) || 0) + 1);
      }
    });
    return teamMap;
  }, [timeframeFilteredBets]);

  // Get prop counts for bookmakers
  const bookmakerPropCounts = useMemo(() => {
    const bookmakerMap = new Map<string, number>();
    timeframeFilteredBets.forEach(bet => {
      const bookmaker = bet.bookmaker || 'Manual Entry';
      bookmakerMap.set(bookmaker, (bookmakerMap.get(bookmaker) || 0) + 1);
    });
    return bookmakerMap;
  }, [timeframeFilteredBets]);
  
  // All NBA teams with counts (showing count only if > 0)
  // Teams with props first, then remaining NBA teams
  const allTeamsWithCounts = useMemo(() => {
    // Get teams that actually have props (from database - keep abbreviations)
    const teamsWithProps = Array.from(teamPropCounts.keys()).map(team => ({
      team,
      count: teamPropCounts.get(team) || 0,
    })).sort((a, b) => a.team.localeCompare(b.team));
    
    // Get remaining NBA teams that don't have props yet (use abbreviations)
    const teamsWithPropsSet = new Set(teamsWithProps.map(t => t.team));
    const allAbbreviations = Object.keys(TEAM_ABBREVIATIONS).sort();
    const teamsWithoutProps = allAbbreviations
      .filter(abbr => !teamsWithPropsSet.has(abbr))
      .map(abbr => ({ team: abbr, count: 0 }));
    
    // Combine: teams with props first, then teams without props
    return [...teamsWithProps, ...teamsWithoutProps];
  }, [teamPropCounts]);

  // Filter bets by selected stat, opponent team, and timeframe for advanced stats
  const statFilteredBets = useMemo(() => {
    let filtered = timeframeFilteredBets;
    
    // Filter by stat
    if (selectedStat !== 'all') {
      filtered = filtered.filter(bet => bet.stat === selectedStat);
    }
    
    // Filter by opponent team
    if (selectedTeam !== 'all') {
      filtered = filtered.filter(bet => bet.opponent === selectedTeam);
    }
    
    return filtered;
  }, [timeframeFilteredBets, selectedStat, selectedTeam]);
  
  const resultedBets = statFilteredBets.filter(bet => bet.result === 'win' || bet.result === 'loss').length;
  const wins = statFilteredBets.filter(bet => bet.result === 'win').length;
  const losses = statFilteredBets.filter(bet => bet.result === 'loss').length;
  const winRate = resultedBets > 0 ? ((wins / resultedBets) * 100).toFixed(1) : '0.0';
  
  // Over/Under breakdown
  const overBets = statFilteredBets.filter(bet => bet.selection?.toLowerCase().includes('over'));
  const overResulted = overBets.filter(bet => bet.result === 'win' || bet.result === 'loss').length;
  const overWins = overBets.filter(bet => bet.result === 'win').length;
  const overLosses = overBets.filter(bet => bet.result === 'loss').length;
  const overWinRate = overResulted > 0 ? ((overWins / overResulted) * 100).toFixed(1) : '0.0';
  
  const underBets = statFilteredBets.filter(bet => bet.selection?.toLowerCase().includes('under'));
  const underResulted = underBets.filter(bet => bet.result === 'win' || bet.result === 'loss').length;
  const underWins = underBets.filter(bet => bet.result === 'win').length;
  const underLosses = underBets.filter(bet => bet.result === 'loss').length;
  const underWinRate = underResulted > 0 ? ((underWins / underResulted) * 100).toFixed(1) : '0.0';
  
  // Winners by Odds ranges (in decimal odds) - 20 cent increments from $1 to $2
  const oddsRanges = [
    { label: '1.00-1.20', min: 1.0, max: 1.2 },
    { label: '1.20-1.40', min: 1.2, max: 1.4 },
    { label: '1.40-1.60', min: 1.4, max: 1.6 },
    { label: '1.60-1.80', min: 1.6, max: 1.8 },
    { label: '1.80-2.00', min: 1.8, max: 2.0 },
  ];
  
  const getOddsRangeStats = (min: number, max: number, isLast: boolean = false) => {
    const betsInRange = statFilteredBets.filter(bet => {
      const odds = bet.odds;
      // For ranges, use >= min && <= max (inclusive on both ends)
      // For the last range, also use <= max to include the upper bound
      // This means 1.8 goes into 1.60-1.80, not 1.80-2.00
      const inRange = isLast 
        ? (odds > min && odds <= max) // Last range: > min && <= max (so 1.8 goes in previous range)
        : (odds >= min && odds <= max); // Other ranges: >= min && <= max (includes both bounds)
      return inRange && (bet.result === 'win' || bet.result === 'loss');
    });
    const wins = betsInRange.filter(bet => bet.result === 'win').length;
    const losses = betsInRange.filter(bet => bet.result === 'loss').length;
    const total = betsInRange.length;
    return { wins, losses, total, winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0' };
  };
  
  // Bookmaker Performance breakdown
  const bookmakerStats = useMemo(() => {
    // List of all bookmakers we're fetching from
    const allBookmakers = [
      'DraftKings',
      'FanDuel', 
      'BetMGM',
      'Caesars',
      'BetRivers',
      'PointsBet',
      'Bet365',
      'Manual Entry'
    ];
    
    const bookmakerMap = new Map<string, { wins: number; losses: number; total: number }>();
    
    // Initialize all bookmakers with 0 stats
    allBookmakers.forEach(bookmaker => {
      bookmakerMap.set(bookmaker, { wins: 0, losses: 0, total: 0 });
    });
    
    // Count actual bets
    for (const bet of statFilteredBets) {
      if (bet.result !== 'win' && bet.result !== 'loss') continue;
      
      const bookmaker = bet.bookmaker || 'Manual Entry';
      const current = bookmakerMap.get(bookmaker) || { wins: 0, losses: 0, total: 0 };
      
      if (bet.result === 'win') current.wins++;
      if (bet.result === 'loss') current.losses++;
      current.total++;
      
      bookmakerMap.set(bookmaker, current);
    }
    
    const result = Array.from(bookmakerMap.entries())
      .map(([bookmaker, stats]) => ({
        bookmaker,
        wins: stats.wins,
        losses: stats.losses,
        total: stats.total,
        hitRate: stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : '0.0'
      }))
      .filter(stat => stat.total > 0) // Only show bookmakers that have been used
      .sort((a, b) => {
        // Manual Entry always last
        if (a.bookmaker === 'Manual Entry') return 1;
        if (b.bookmaker === 'Manual Entry') return -1;
        // Sort others by most used
        return b.total - a.total;
      });
    
    return result;
  }, [statFilteredBets]);
  
  // Filter bets by search query, opponent team, bookmaker, and timeframe
  const filteredBets = useMemo(() => {
    let filtered = timeframeFilteredBets;
    
    // Filter by opponent team
    if (selectedTeam !== 'all') {
      filtered = filtered.filter(bet => bet.opponent === selectedTeam);
    }
    
    // Filter by bookmaker
    if (selectedBookmaker !== 'all') {
      filtered = filtered.filter(bet => {
        const betBookmaker = bet.bookmaker || 'Manual Entry';
        return betBookmaker === selectedBookmaker;
      });
    }
    
    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(bet => 
        bet.playerName?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        bet.selection?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [timeframeFilteredBets, searchQuery, selectedTeam, selectedBookmaker]);
  
  // Pagination calculations
  const totalPages = Math.ceil(filteredBets.length / PROPS_PER_PAGE);
  const startIndex = (currentPage - 1) * PROPS_PER_PAGE;
  const endIndex = startIndex + PROPS_PER_PAGE;
  const paginatedBets = filteredBets.slice(startIndex, endIndex);
  
  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const getResultColor = (result: string) => {
    switch(result) {
      case 'win': return 'text-emerald-600 dark:text-emerald-400';
      case 'loss': return 'text-red-600 dark:text-red-400';
      case 'pending': return 'text-yellow-600 dark:text-yellow-400';
      case 'void': return 'text-gray-600 dark:text-gray-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getResultBadge = (result: string) => {
    switch(result) {
      case 'win': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
      case 'loss': return 'bg-red-500/10 text-red-600 dark:text-red-400';
      case 'pending': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
      case 'void': return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
      default: return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
    }
  };

  // Check if any filters are active
  const hasActiveFilters = selectedTeam !== 'all' || selectedBookmaker !== 'all' || selectedTimeframe !== 'all';

  // Clear all filters
  const clearFilters = () => {
    setSelectedTeam('all');
    setSelectedBookmaker('all');
    setSelectedTimeframe('all');
  };

  return (
    <div
      className={isMobileView 
        ? "flex flex-col w-full h-full bg-white dark:bg-slate-900"
        : "hidden lg:flex fixed top-4 h-[calc(100vh-1rem)] bg-gray-300 dark:bg-slate-900 border-l border-gray-200 dark:border-gray-700 flex-col rounded-l-2xl shadow-xl"
      }
      style={isMobileView ? {} : {
        marginRight: '0px',
        width: 'var(--right-panel-width, 360px)',
        right: 'clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px)'
      }}
    >
      {/* Profile Icon - Above Tabs */}
      {showProfileIcon && !isMobileView && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Your Props</h2>
          <div className="relative" ref={profileMenuRef}>
            <button
              data-profile-button
              onClick={onProfileMenuClick}
              className="w-10 h-10 rounded-full hover:opacity-90 transition-opacity border border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden"
              style={avatarColor ? { backgroundColor: avatarColor } : avatarUrl ? {} : { backgroundColor: 'rgb(243, 244, 246)' }}
            >
              {avatarUrl ? (
                <img 
                  src={avatarUrl} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-sm font-semibold text-white">
                  {fallbackInitial}
                </span>
              )}
            </button>
            
            {/* Profile Menu Dropdown */}
            {showProfileMenu && (
              <div data-profile-menu className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                {/* Username display */}
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Logged in as</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{username || userEmail || 'User'}</p>
                </div>
                
                {/* Menu Items */}
                <div className="py-2">
                  <button
                    type="button"
                    onClick={onSubscriptionClick}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    Subscription
                  </button>
                </div>
                
                {/* Logout button */}
                <div className="border-t border-gray-200 dark:border-gray-700 py-2">
                  <button
                    type="button"
                    onClick={onSignOutClick}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Header with Tabs */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 text-black dark:text-white">
        {showAdvanced ? (
          // Advanced Stats Header
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Advanced Stats</h3>
              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-xs px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">
                Insights
              </div>
              <button
                onClick={fetchJournalBets}
                disabled={isRefreshing}
                className="text-xs px-2 py-1 rounded-lg bg-purple-500/10 text-purple-500 dark:text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center gap-1 disabled:opacity-50"
                title="Refresh journal"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </>
        )}
      </div>
      
      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {showAdvanced ? (
          // Advanced Stats View
          <div className="p-3 flex flex-col gap-1 h-full">
            {/* Win Rate Progress Bar - At the top */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-black dark:text-white">Overall Win Rate</h4>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {resultedBets} props ({wins}-{losses})
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6 relative">
                <div 
                  className={`h-6 rounded-full transition-all duration-500 flex items-center justify-end pr-2 ${
                    parseFloat(winRate) <= 29 
                      ? 'bg-gradient-to-r from-red-500 to-red-600' 
                      : parseFloat(winRate) <= 49 
                      ? 'bg-gradient-to-r from-orange-500 to-amber-600' 
                      : 'bg-gradient-to-r from-green-500 to-emerald-600'
                  }`}
                  style={{ width: `${Math.max(parseFloat(winRate), 0)}%`, minWidth: winRate !== '0.0' ? 'auto' : '0' }}
                >
                  {parseFloat(winRate) > 5 && (
                    <span className="text-xs font-bold text-white">{winRate}%</span>
                  )}
                </div>
                {parseFloat(winRate) <= 5 && parseFloat(winRate) > 0 && (
                  <span className="absolute left-2 top-1/2 transform -translate-y-1/2 text-xs font-bold text-gray-700 dark:text-gray-300">{winRate}%</span>
                )}
                {parseFloat(winRate) === 0 && (
                  <span className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-xs font-bold text-gray-700 dark:text-gray-300">0.0%</span>
                )}
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-gray-600 dark:text-gray-400">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
            
            {/* Over vs Under Performance */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h4 className="text-xs font-semibold text-black dark:text-white mb-2 text-center">Over vs Under</h4>
              <div className="flex items-start gap-2">
                {/* Over Side */}
                <div className="flex-1 space-y-2">
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-400 text-center mb-1">Over</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="text-xs font-bold text-black dark:text-white">{overBets.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Record:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-green-600 dark:text-green-400">{overWins}</span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">-</span>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400">{overLosses}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Hit Rate:</span>
                    <span className="text-sm font-bold text-black dark:text-white">{overWinRate}%</span>
                  </div>
                </div>
                
                {/* Divider with VS */}
                <div className="flex-shrink-0 flex items-center justify-center px-2">
                  <div className="relative">
                    <div className="h-20 w-px bg-gray-200 dark:bg-gray-700"></div>
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold">
                      VS
                    </div>
                  </div>
                </div>
                
                {/* Under Side */}
                <div className="flex-1 space-y-2">
                  <div className="text-xs font-medium text-purple-600 dark:text-purple-400 text-center mb-1">Under</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="text-xs font-bold text-black dark:text-white">{underBets.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Record:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-green-600 dark:text-green-400">{underWins}</span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">-</span>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400">{underLosses}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Hit Rate:</span>
                    <span className="text-sm font-bold text-black dark:text-white">{underWinRate}%</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Bookmaker Performance */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700 flex-[1.5] min-h-0 flex flex-col overflow-y-auto custom-scrollbar">
              <h4 className="text-xs font-semibold text-black dark:text-white mb-1.5">Bookmaker Performance</h4>
              <div className="space-y-0.5 flex-1 flex flex-col justify-around">
                {bookmakerStats.map((stat) => (
                  <div key={stat.bookmaker} className="flex items-center gap-14">
                    <span className="text-xs font-medium text-purple-600 dark:text-purple-400 truncate w-[70px] flex-shrink-0">
                      {stat.bookmaker === 'Manual Entry' ? 'Manual' : stat.bookmaker}
                    </span>
                    <div className="flex items-center gap-1 text-xs w-[45px] flex-shrink-0">
                      <span className="font-bold text-green-600 dark:text-green-400">{stat.wins}</span>
                      <span className="text-gray-600 dark:text-gray-400">-</span>
                      <span className="font-bold text-red-600 dark:text-red-400">{stat.losses}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-12 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 flex-shrink-0">
                        <div 
                          className="bg-gradient-to-r from-green-500 to-emerald-600 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${stat.hitRate}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-black dark:text-white w-[38px] text-right flex-shrink-0">
                        {stat.hitRate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Winners by Odds */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700 flex-[1.8] min-h-0 flex flex-col">
              <h4 className="text-xs font-semibold text-black dark:text-white mb-1.5">Winners by Odds</h4>
              <div className="space-y-0.5 flex-1 flex flex-col justify-around">
                {oddsRanges
                  .map((range, index) => {
                    const isLast = index === oddsRanges.length - 1;
                    const stats = getOddsRangeStats(range.min, range.max, isLast);
                    return { range, stats };
                  })
                  .filter(({ stats }) => stats.total > 0) // Only show odds ranges that have been used
                  .map(({ range, stats }) => (
                    <div key={range.label} className="flex items-center gap-14">
                      <span className="text-xs text-gray-600 dark:text-gray-400 w-[70px] flex-shrink-0">{range.label}:</span>
                      <div className="flex items-center gap-1 text-xs w-[45px] flex-shrink-0">
                        <span className="font-bold text-green-600 dark:text-green-400">{stats.wins}</span>
                        <span className="text-gray-600 dark:text-gray-400">-</span>
                        <span className="font-bold text-red-600 dark:text-red-400">{stats.losses}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-12 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 flex-shrink-0">
                          <div 
                            className="bg-gradient-to-r from-green-500 to-emerald-600 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${stats.winRate}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-black dark:text-white w-[38px] text-right flex-shrink-0">
                          {stats.winRate}%
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ) : (
          (() => {
            const insights = generateInsights(journalBets);
            const settledBets = journalBets.filter(b => b.result === 'win' || b.result === 'loss');
            
            if (journalBets.length === 0) {
              return (
                <div className="p-4 text-center text-black dark:text-white opacity-70">
                  <div className="text-sm">No bets in journal yet</div>
                  <div className="text-xs mt-2">Add bets from the research pages to track your betting history</div>
                </div>
              );
            }
            
            if (settledBets.length < 10) {
              return (
                <div className="p-4 text-center text-black dark:text-white opacity-70">
                  <div className="text-sm">Add more bets to see insights</div>
                  <div className="text-xs mt-2">You need at least 10 settled bets to generate insights</div>
                  <div className="text-xs mt-1 text-gray-500 dark:text-gray-400">
                    You have {settledBets.length} settled {settledBets.length === 1 ? 'bet' : 'bets'}
                  </div>
                </div>
              );
            }
            
            if (insights.length === 0) {
              return (
                <div className="p-4 text-center text-black dark:text-white opacity-70">
                  <div className="text-sm">No insights available yet</div>
                  <div className="text-xs mt-2">Keep betting to see patterns and insights</div>
                </div>
              );
            }
            
            return (
              <div className="p-4 space-y-3">
                {insights.map((insight) => {
                  const getColorClasses = () => {
                    switch (insight.color) {
                      case 'red':
                        return {
                          border: 'border-l-4 border-red-500 dark:border-red-400',
                          bg: 'bg-red-50/80 dark:bg-red-950/30',
                          text: 'text-red-900 dark:text-red-100',
                          iconBg: 'bg-red-100 dark:bg-red-900/50',
                        };
                      case 'green':
                        return {
                          border: 'border-l-4 border-green-500 dark:border-green-400',
                          bg: 'bg-green-50/80 dark:bg-green-950/30',
                          text: 'text-green-900 dark:text-green-100',
                          iconBg: 'bg-green-100 dark:bg-green-900/50',
                        };
                      case 'blue':
                        return {
                          border: 'border-l-4 border-blue-500 dark:border-blue-400',
                          bg: 'bg-blue-50/80 dark:bg-blue-950/30',
                          text: 'text-blue-900 dark:text-blue-100',
                          iconBg: 'bg-blue-100 dark:bg-blue-900/50',
                        };
                      case 'yellow':
                        return {
                          border: 'border-l-4 border-yellow-500 dark:border-yellow-400',
                          bg: 'bg-yellow-50/80 dark:bg-yellow-950/30',
                          text: 'text-yellow-900 dark:text-yellow-100',
                          iconBg: 'bg-yellow-100 dark:bg-yellow-900/50',
                        };
                      default:
                        return {
                          border: 'border-l-4 border-gray-300 dark:border-gray-600',
                          bg: 'bg-gray-50/80 dark:bg-gray-900/30',
                          text: 'text-gray-900 dark:text-gray-100',
                          iconBg: 'bg-gray-100 dark:bg-gray-800',
                        };
                    }
                  };
                  
                  const getIcon = () => {
                    switch (insight.type) {
                      case 'loss':
                        return '📉';
                      case 'win':
                        return '📈';
                      case 'comparison':
                        return '⚖️';
                      case 'streak':
                        return '🔥';
                      default:
                        return '💡';
                    }
                  };
                  
                  const colors = getColorClasses();
                  
                  return (
                    <div
                      key={insight.id}
                      className={`rounded-r-lg ${colors.bg} ${colors.border} shadow-sm hover:shadow-md transition-shadow`}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`flex-shrink-0 w-10 h-10 rounded-full ${colors.iconBg} flex items-center justify-center text-xl`}>
                            {getIcon()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold leading-relaxed ${colors.text}`}>
                              {insight.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>
      
    </div>
  );
}
