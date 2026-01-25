"use client";

import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useTrackedBets } from "../contexts/TrackedBetsContext";
import { Plus, X, TrendingUp, History, Target, RefreshCw, Search, ChevronDown, ChevronUp, Filter, TrendingDown, Minus, BarChart3, Lightbulb } from "lucide-react";
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

type TabType = 'tracked' | 'journal';

export interface Insight {
  id: string;
  type: 'loss' | 'win' | 'comparison' | 'streak' | 'neutral' | 'pain';
  category: 'stat' | 'player' | 'parlay' | 'over_under' | 'opponent' | 'bet_type';
  message: string;
  priority: number; // Higher = more important (for sorting)
  color: 'red' | 'green' | 'yellow' | 'blue' | 'orange';
  // Additional data for expanded view
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
  potentialProfit?: number; // For pain points - what could have been
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
    // Basic stats
    'pts': 'Points',
    'reb': 'Rebounds',
    'ast': 'Assists',
    'stl': 'Steals',
    'blk': 'Blocks',
    'fg3m': '3-Pointers Made',
    // Combined stats
    'pr': 'Points + Rebounds',
    'pra': 'Points + Rebounds + Assists',
    'ra': 'Rebounds + Assists',
    'pa': 'Points + Assists',
    // Game props (if they ever appear in player bets somehow)
    'moneyline': 'Moneyline',
    'spread': 'Spread',
    'total_pts': 'Total Points',
    'home_total': 'Home Total',
    'away_total': 'Away Total',
    'first_half_total': '1st Half Total',
    'second_half_total': '2nd Half Total',
    'q1_total': 'Q1 Total',
    'q2_total': 'Q2 Total',
    'q3_total': 'Q3 Total',
    'q4_total': 'Q4 Total',
    'q1_moneyline': 'Q1 Moneyline',
    'q2_moneyline': 'Q2 Moneyline',
    'q3_moneyline': 'Q3 Moneyline',
    'q4_moneyline': 'Q4 Moneyline',
  };
  const lowerStat = stat.toLowerCase();
  if (statMap[lowerStat]) {
    return statMap[lowerStat];
  }
  // Fallback: try to format nicely
  return stat
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
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
  const templateFn = templates[index] as (...args: any[]) => string;
  return templateFn(...args);
}

// Generate insights from journal bets
export function generateInsights(bets: JournalBet[]): Insight[] {
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
  
  // Track which stat+over/under combinations have insights to avoid duplicates at overall stat level
  const statOverUnderWithInsights = new Set<string>();
  
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
        
        const wagered = data.bets.reduce((sum, bet) => sum + bet.stake, 0);
        const returned = data.bets.reduce((sum, bet) => {
          if (bet.result === 'win') return sum + (bet.stake * bet.odds);
          return sum;
        }, 0);
        const profit = returned - wagered;
        const roi = wagered > 0 ? Math.round((profit / wagered) * 100) : 0;
        
        // Neutral/Orange insight - close to even (win rate 45-55%, or small profit/loss)
        // Check this FIRST and mark that we have an insight for this stat
        if (winRate >= 45 && winRate <= 55 && total >= 4) {
          const isCloseToEven = Math.abs(winRate - 50) <= 5 && Math.abs(profit) < wagered * 0.1; // Within 10% of even
          
          if (isCloseToEven) {
            statOverUnderWithInsights.add(`${stat}-${overUnder}`);
            insights.push({
              id: `stat-overunder-neutral-${stat}-${overUnder}`,
              type: 'neutral',
              category: 'stat',
              message: `${overUnderLabel} ${statName} bets are basically breaking even - ${winRate}% win rate (${data.wins}/${total}). Not losing money, but not generating significant returns either.`,
              priority: total * 3,
              color: 'blue',
              stats: {
                wins: data.wins,
                losses: data.losses,
                total: total,
                winRate: winRate,
                profit: profit,
                wagered: wagered,
                returned: returned,
                roi: roi,
              },
              relatedBets: data.bets,
              recommendation: `${overUnderLabel} ${statName} bets are close to break-even. Consider whether the time and risk is worth the minimal returns, or try to identify patterns that could improve results.`,
            });
            // Don't create additional insights for this stat+over/under combo
            return; // This exits the forEach iteration for this stat+over/under combination
          }
        }
        
        // High win rate insight
        if (winRate >= 60 && total >= 3) {
          statOverUnderWithInsights.add(`${stat}-${overUnder}`);
          const wagered = data.bets.reduce((sum, bet) => sum + bet.stake, 0);
          const returned = data.bets.reduce((sum, bet) => {
            if (bet.result === 'win') return sum + (bet.stake * bet.odds);
            return sum;
          }, 0);
          const profit = returned - wagered;
          const roi = wagered > 0 ? Math.round((profit / wagered) * 100) : 0;
          
          insights.push({
            id: `stat-overunder-win-${stat}-${overUnder}`,
            type: 'win',
            category: 'stat',
            message: getDeterministicMessage(`stat-overunder-win-${stat}-${overUnder}`, 'statOverUnderWin', winRate, data.wins, total, overUnderLabel, statName),
            priority: winRate * 10 + total * 5,
            color: 'green',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: total,
              winRate: winRate,
              profit: profit,
              wagered: wagered,
              returned: returned,
              roi: roi,
            },
            relatedBets: data.bets,
            recommendation: `Consider focusing more on ${overUnderLabel} ${statName} bets as you're seeing strong results here.`,
          });
        }
        // Low win rate insight - lowered thresholds to show more losses
        if (winRate < 45 && total >= 3 && data.losses >= 2) {
          statOverUnderWithInsights.add(`${stat}-${overUnder}`);
          insights.push({
            id: `stat-overunder-loss-${stat}-${overUnder}`,
            type: 'loss',
            category: 'stat',
            message: getDeterministicMessage(`stat-overunder-loss-${stat}-${overUnder}`, 'statOverUnderLoss', winRate, data.wins, total, overUnderLabel, statName),
            priority: data.losses * 15 + total * 5,
            color: 'red',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: total,
              winRate: winRate,
              profit: profit,
              wagered: wagered,
              returned: returned,
              roi: roi,
            },
            relatedBets: data.bets,
            recommendation: `You might want to reconsider ${overUnderLabel} ${statName} bets or analyze why they're not performing well.`,
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
  // Only create overall stat insights if we don't already have over/under insights for this stat
  Object.entries(statGroups).forEach(([stat, data]) => {
    const total = data.wins + data.losses;
    if (total >= 5 && data.wagered >= 50) {
      const statName = formatStatName(stat);
      const profit = data.returned - data.wagered;
      const roi = Math.round((profit / data.wagered) * 100);
      
      // Check if we already have over/under insights for this stat
      // If so, skip overall stat insights to avoid duplicates
      const hasOverUnderInsight = statOverUnderWithInsights.has(`${stat}-over`) || statOverUnderWithInsights.has(`${stat}-under`);
      if (hasOverUnderInsight) {
        return; // Skip creating overall stat insight since we have more specific over/under insights
      }
      
      // Neutral ROI insight - close to break-even
      if (Math.abs(roi) >= -10 && Math.abs(roi) <= 10 && total >= 5 && Math.abs(profit) < data.wagered * 0.15) {
        insights.push({
          id: `stat-financial-neutral-${stat}`,
          type: 'neutral',
          category: 'stat',
          message: `${statName} bets are basically break-even. You've wagered $${data.wagered.toFixed(2)} and returned $${data.returned.toFixed(2)} (${roi >= 0 ? '+' : ''}${roi}% ROI). Not terrible, but not profitable either.`,
          priority: total * 2 + Math.abs(profit),
          color: 'blue',
          stats: {
            wins: data.wins,
            losses: data.losses,
            total: total,
            winRate: Math.round((data.wins / total) * 100),
            profit: profit,
            wagered: data.wagered,
            returned: data.returned,
            roi: roi,
          },
          relatedBets: data.bets,
          recommendation: `${statName} bets are hovering around break-even. The minimal returns may not justify the risk and time. Consider refining your approach or focusing on more profitable categories.`,
        });
      }
      
      // Negative ROI insight - lowered threshold to show more losses
      if (profit < 0 && Math.abs(profit) >= 10 && Math.abs(roi) > 10) {
        insights.push({
          id: `stat-financial-loss-${stat}`,
          type: 'loss',
          category: 'stat',
          message: getDeterministicMessage(`stat-financial-loss-${stat}`, 'financialLoss', data.wagered, data.returned, roi, statName, total, profit),
          priority: Math.abs(profit) * 3 + total * 3 + data.losses * 5,
          color: 'red',
          stats: {
            wins: data.wins,
            losses: data.losses,
            total: total,
            profit: profit,
            wagered: data.wagered,
            returned: data.returned,
            roi: roi,
          },
          relatedBets: data.bets,
          recommendation: `${statName} bets are losing money. Consider reducing stakes or analyzing why they're underperforming.`,
        });
      }
      // Positive ROI insight
      if (profit > 0 && profit >= 20 && roi > 10) {
        insights.push({
          id: `stat-financial-win-${stat}`,
          type: 'win',
          category: 'stat',
          message: getDeterministicMessage(`stat-financial-win-${stat}`, 'financialWin', data.wagered, data.returned, roi, statName, total, profit),
          priority: profit * 2 + total * 3,
          color: 'green',
          stats: {
            wins: data.wins,
            losses: data.losses,
            total: total,
            profit: profit,
            wagered: data.wagered,
            returned: data.returned,
            roi: roi,
          },
          relatedBets: data.bets,
          recommendation: `${statName} is one of your most profitable categories. Consider increasing focus here.`,
        });
      }
      
      // Also show loss insights for stats with many losses even if ROI isn't terrible
      // Skip if we already have over/under insights for this stat to avoid duplicates
      if (!hasOverUnderInsight && data.losses >= 4 && total >= 6) {
        const lossRate = Math.round((data.losses / total) * 100);
        if (lossRate >= 40) {
          const profit = data.returned - data.wagered;
          const roi = data.wagered > 0 ? Math.round((profit / data.wagered) * 100) : 0;
          
          insights.push({
            id: `stat-loss-count-${stat}`,
            type: 'loss',
            category: 'stat',
            message: getDeterministicMessage(`stat-loss-count-${stat}`, 'statLossCount', data.losses, total, lossRate, statName),
            priority: data.losses * 12 + total * 3,
            color: 'red',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: total,
              winRate: Math.round((data.wins / total) * 100),
              profit: profit,
              wagered: data.wagered,
              returned: data.returned,
              roi: roi,
            },
            relatedBets: data.bets,
            recommendation: `${statName} bets have a high loss rate. Review your betting strategy for this category.`,
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
    const wagered = data.bets.reduce((sum, bet) => sum + bet.stake, 0);
    const returned = data.bets.reduce((sum, bet) => {
      if (bet.result === 'win') return sum + (bet.stake * bet.odds);
      return sum;
    }, 0);
    const profit = returned - wagered;
    const winRate = Math.round((data.wins / total) * 100);
    const lossRate = Math.round((data.losses / total) * 100);
    const roi = wagered > 0 ? Math.round((profit / wagered) * 100) : 0;
    
    if (total >= 4) {
      // Neutral player insight - close to break-even
      if ((winRate >= 45 && winRate <= 55) && Math.abs(profit) < wagered * 0.12) {
        insights.push({
          id: `player-neutral-${player}`,
          type: 'neutral',
          category: 'player',
          message: `${player} bets are basically break-even. ${winRate}% win rate (${data.wins}W-${data.losses}L) with ${roi >= 0 ? '+' : ''}${roi}% ROI. Not losing, but not making meaningful gains either.`,
          priority: total * 2,
          color: 'blue',
          stats: {
            wins: data.wins,
            losses: data.losses,
            total: total,
            winRate: winRate,
            profit: profit,
            wagered: wagered,
            returned: returned,
            roi: roi,
          },
          relatedBets: data.bets,
          recommendation: `${player} bets are hovering around break-even. The minimal returns may not justify continued focus. Consider whether this player fits your strategy.`,
        });
      }
    }
    
    if (total >= 3 && data.losses >= 2) {
      // Show if loss rate is 40% or more
      if (lossRate >= 40) {
        insights.push({
          id: `player-loss-${player}`,
          type: 'loss',
          category: 'player',
          message: getDeterministicMessage(`player-loss-${player}`, 'playerLoss', data.losses, total, lossRate, player),
          priority: data.losses * 12 + total,
          color: 'red',
          stats: {
            wins: data.wins,
            losses: data.losses,
            total: total,
            winRate: winRate,
            profit: profit,
            wagered: wagered,
            returned: returned,
            roi: roi,
          },
          relatedBets: data.bets,
          recommendation: `Consider avoiding ${player} bets or reviewing your approach to betting on this player.`,
        });
      }
    }
    // Find best player (high win rate)
    if (total >= 5 && data.wins >= 3) {
      const winRate = Math.round((data.wins / total) * 100);
      if (winRate >= 60) {
        const wagered = data.bets.reduce((sum, bet) => sum + bet.stake, 0);
        const returned = data.bets.reduce((sum, bet) => {
          if (bet.result === 'win') return sum + (bet.stake * bet.odds);
          return sum;
        }, 0);
        const profit = returned - wagered;
        
        insights.push({
          id: `player-win-${player}`,
          type: 'win',
          category: 'player',
          message: getDeterministicMessage(`player-win-${player}`, 'playerWin', winRate, data.wins, total, player),
          priority: winRate * 10 + total,
          color: 'green',
          stats: {
            wins: data.wins,
            losses: data.losses,
            total: total,
            winRate: winRate,
            profit: profit,
            wagered: wagered,
            returned: returned,
          },
          relatedBets: data.bets,
          recommendation: `${player} is performing well for you. Consider continuing to focus on this player.`,
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
    const overWagered = getTotalWagered(overBets);
    const overReturned = getTotalReturned(overBets);
    const overProfit = overReturned - overWagered;
    const overROI = overWagered > 0 ? Math.round((overProfit / overWagered) * 100) : 0;
    
    // Only show as loss if win rate is below 50% (actually losing)
    if (overLosses > overWins && overWinRate < 50) {
      insights.push({
        id: 'over-loss',
        type: 'loss',
        category: 'over_under',
        message: getDeterministicMessage('over-loss', 'overUnderLoss', overLosses, overWins, overWinRate, 'Over'),
        priority: overLosses * 12,
        color: 'red',
        stats: {
          wins: overWins,
          losses: overLosses,
          total: overBets.length,
          winRate: overWinRate,
          profit: overProfit,
          wagered: overWagered,
          returned: overReturned,
          roi: overROI,
        },
        relatedBets: overBets,
        recommendation: 'Over bets are underperforming. Consider focusing on Under bets or reviewing your Over betting strategy.',
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
        stats: {
          wins: overWins,
          losses: overLosses,
          total: overBets.length,
          winRate: overWinRate,
          profit: overProfit,
          wagered: overWagered,
          returned: overReturned,
          roi: overROI,
        },
        relatedBets: overBets,
        recommendation: 'Over bets are working well for you! Consider focusing more on Over betting opportunities.',
      });
    }
  }
  
  if (underBets.length >= 4) {
    const underWins = underBets.filter(b => b.result === 'win').length;
    const underLosses = underBets.filter(b => b.result === 'loss').length;
    const underWinRate = Math.round((underWins / underBets.length) * 100);
    const underWagered = getTotalWagered(underBets);
    const underReturned = getTotalReturned(underBets);
    const underProfit = underReturned - underWagered;
    const underROI = underWagered > 0 ? Math.round((underProfit / underWagered) * 100) : 0;
    
    // Only show as loss if win rate is below 50% (actually losing)
    if (underLosses > underWins && underWinRate < 50) {
      insights.push({
        id: 'under-loss',
        type: 'loss',
        category: 'over_under',
        message: getDeterministicMessage('under-loss', 'overUnderLoss', underLosses, underWins, underWinRate, 'Under'),
        priority: underLosses * 12,
        color: 'red',
        stats: {
          wins: underWins,
          losses: underLosses,
          total: underBets.length,
          winRate: underWinRate,
          profit: underProfit,
          wagered: underWagered,
          returned: underReturned,
          roi: underROI,
        },
        relatedBets: underBets,
        recommendation: 'Under bets are underperforming. Consider focusing on Over bets or reviewing your Under betting strategy.',
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
        stats: {
          wins: underWins,
          losses: underLosses,
          total: underBets.length,
          winRate: underWinRate,
          profit: underProfit,
          wagered: underWagered,
          returned: underReturned,
          roi: underROI,
        },
        relatedBets: underBets,
        recommendation: 'Under bets are working well for you! Consider focusing more on Under betting opportunities.',
      });
    }
  }
  
  // === PARLAY INSIGHTS ===
  
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
        message: getDeterministicMessage('parlay-loss', 'parlayLoss', parlayLosses, parlayBets.length),
        priority: parlayLosses * 15,
        color: 'red',
        stats: {
          wins: parlayWins,
          losses: parlayLosses,
          total: parlayBets.length,
          winRate: parlayWinRate,
          profit: parlayProfit,
          wagered: parlayWagered,
          returned: parlayReturned,
          roi: parlayROI,
        },
        relatedBets: parlayBets,
        recommendation: 'Parlays are losing money. Consider reducing parlay frequency or focusing on straight bets which may have better returns.',
      });
    }
    
    // Analyze parlay legs by player - track which players appear in winning vs losing parlays
    const parlayPlayerGroups: Record<string, { wins: number; losses: number; legWins: number; legLosses: number; totalAppearances: number }> = {};
    parlayBets.forEach(bet => {
      const parlayResult = bet.result === 'win';
      if (bet.parlay_legs) {
        bet.parlay_legs.forEach(leg => {
          const playerName = leg.playerName;
          if (playerName) {
            if (!parlayPlayerGroups[playerName]) {
              parlayPlayerGroups[playerName] = { wins: 0, losses: 0, legWins: 0, legLosses: 0, totalAppearances: 0 };
            }
            // Track if this player's parlay won or lost
            if (parlayResult) {
              parlayPlayerGroups[playerName].wins++;
            } else {
              parlayPlayerGroups[playerName].losses++;
            }
            // Track individual leg results
            if (leg.won) {
              parlayPlayerGroups[playerName].legWins++;
            } else if (leg.won === false) {
              parlayPlayerGroups[playerName].legLosses++;
            }
            parlayPlayerGroups[playerName].totalAppearances++;
          }
        });
      }
    });
    
    // Generate insights for players in parlays
    Object.entries(parlayPlayerGroups).forEach(([player, data]) => {
      const totalParlays = data.wins + data.losses;
      if (totalParlays >= 3) {
        const parlayWinRate = Math.round((data.wins / totalParlays) * 100);
        const legWinRate = data.totalAppearances > 0 ? Math.round((data.legWins / data.totalAppearances) * 100) : 0;
        
        // High win rate when this player is in parlays
        if (parlayWinRate >= 60 && totalParlays >= 3) {
          insights.push({
            id: `parlay-player-win-${player}`,
            type: 'win',
            category: 'parlay',
            message: `When ${player} is in your parlays, you win ${parlayWinRate}% of the time (${data.wins}W-${data.losses}L)`,
            priority: parlayWinRate * 5 + totalParlays * 3,
            color: 'green',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: totalParlays,
              winRate: parlayWinRate,
            },
            recommendation: `${player} is a strong parlay performer for you. Consider including them more frequently in your parlay combinations.`,
          });
        }
        
        // Low win rate when this player is in parlays
        if (parlayWinRate < 40 && data.losses >= 2 && totalParlays >= 3) {
          insights.push({
            id: `parlay-player-loss-${player}`,
            type: 'loss',
            category: 'parlay',
            message: `When ${player} is in your parlays, you lose ${100 - parlayWinRate}% of the time (${data.wins}W-${data.losses}L)`,
            priority: data.losses * 10 + totalParlays * 3,
            color: 'red',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: totalParlays,
              winRate: parlayWinRate,
            },
            recommendation: `${player} is underperforming in your parlays. Consider removing them from parlay combinations or betting on them as straight bets instead.`,
          });
        }
        
        // Neutral win rate (break-even)
        if (parlayWinRate >= 40 && parlayWinRate <= 60 && totalParlays >= 4) {
          insights.push({
            id: `parlay-player-neutral-${player}`,
            type: 'neutral',
            category: 'parlay',
            message: `When ${player} is in your parlays, you win ${parlayWinRate}% of the time (${data.wins}W-${data.losses}L). Their individual leg win rate is ${legWinRate}%`,
            priority: totalParlays * 2,
            color: 'blue',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: totalParlays,
              winRate: parlayWinRate,
            },
            recommendation: `${player} has a neutral impact on your parlay performance. Consider whether their inclusion adds value or if you'd be better off with other players.`,
          });
        }
      }
    });
    
    // Analyze parlay legs by stat
    const parlayStatGroups: Record<string, { wins: number; losses: number; legWins: number; legLosses: number }> = {};
    parlayBets.forEach(bet => {
      const parlayResult = bet.result === 'win';
      if (bet.parlay_legs) {
        bet.parlay_legs.forEach(leg => {
          if (leg.statType && leg.won !== null && leg.won !== undefined) {
            if (!parlayStatGroups[leg.statType]) {
              parlayStatGroups[leg.statType] = { wins: 0, losses: 0, legWins: 0, legLosses: 0 };
            }
            // Track if parlay with this stat won or lost
            if (parlayResult) {
              parlayStatGroups[leg.statType].wins++;
            } else {
              parlayStatGroups[leg.statType].losses++;
            }
            // Track individual leg results
            if (leg.won) {
              parlayStatGroups[leg.statType].legWins++;
            } else {
              parlayStatGroups[leg.statType].legLosses++;
            }
          }
        });
      }
    });
    
    Object.entries(parlayStatGroups).forEach(([stat, data]) => {
      const totalParlays = data.wins + data.losses;
      const totalLegs = data.legWins + data.legLosses;
      
      if (totalParlays >= 3) {
        const parlayWinRate = Math.round((data.wins / totalParlays) * 100);
        const statName = formatStatName(stat);
        
        // High win rate when this stat is in parlays
        if (parlayWinRate >= 60 && totalParlays >= 3) {
          insights.push({
            id: `parlay-stat-win-${stat}`,
            type: 'win',
            category: 'parlay',
            message: `When ${statName} is in your parlays, you win ${parlayWinRate}% of the time (${data.wins}W-${data.losses}L)`,
            priority: parlayWinRate * 5 + totalParlays * 3,
            color: 'green',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: totalParlays,
              winRate: parlayWinRate,
            },
            recommendation: `${statName} is performing well in your parlays. Consider including it more frequently in your parlay combinations.`,
          });
        }
        
        // Low win rate when this stat is in parlays
        if (parlayWinRate < 40 && data.losses >= 2 && totalParlays >= 3) {
          const legWinRate = totalLegs > 0 ? Math.round((data.legWins / totalLegs) * 100) : 0;
          
          insights.push({
            id: `parlay-stat-loss-${stat}`,
            type: 'loss',
            category: 'parlay',
            message: `When ${statName} is in your parlays, you lose ${100 - parlayWinRate}% of the time (${data.wins}W-${data.losses}L). Individual ${statName} legs win ${legWinRate}% of the time`,
            priority: data.losses * 10 + totalParlays * 3,
            color: 'red',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: totalParlays,
              winRate: parlayWinRate,
            },
            recommendation: `${statName} legs are frequently losing in your parlays (${legWinRate}% leg win rate). Consider removing ${statName} from parlay combinations or betting ${statName} as straight bets instead.`,
          });
        }
        
        // Neutral win rate
        if (parlayWinRate >= 40 && parlayWinRate <= 60 && totalParlays >= 4) {
          const legWinRate = totalLegs > 0 ? Math.round((data.legWins / totalLegs) * 100) : 0;
          
          insights.push({
            id: `parlay-stat-neutral-${stat}`,
            type: 'neutral',
            category: 'parlay',
            message: `When ${statName} is in your parlays, you win ${parlayWinRate}% of the time (${data.wins}W-${data.losses}L). Individual ${statName} legs win ${legWinRate}% of the time`,
            priority: totalParlays * 2,
            color: 'blue',
            stats: {
              wins: data.wins,
              losses: data.losses,
              total: totalParlays,
              winRate: parlayWinRate,
            },
            recommendation: `${statName} has a neutral impact on your parlay performance. Consider whether it adds value to your parlay combinations.`,
          });
        }
      }
    });
    
    // Analyze parlay legs by stat + over/under combination
    const parlayStatOverUnderGroups: Record<string, Record<string, { wins: number; losses: number; legWins: number; legLosses: number }>> = {};
    parlayBets.forEach(bet => {
      const parlayResult = bet.result === 'win';
      if (bet.parlay_legs) {
        bet.parlay_legs.forEach(leg => {
          if (leg.statType && leg.overUnder) {
            if (!parlayStatOverUnderGroups[leg.statType]) {
              parlayStatOverUnderGroups[leg.statType] = {};
            }
            if (!parlayStatOverUnderGroups[leg.statType][leg.overUnder]) {
              parlayStatOverUnderGroups[leg.statType][leg.overUnder] = { wins: 0, losses: 0, legWins: 0, legLosses: 0 };
            }
            // Track if parlay with this stat+over/under won or lost
            if (parlayResult) {
              parlayStatOverUnderGroups[leg.statType][leg.overUnder].wins++;
            } else {
              parlayStatOverUnderGroups[leg.statType][leg.overUnder].losses++;
            }
            // Track individual leg results
            if (leg.won) {
              parlayStatOverUnderGroups[leg.statType][leg.overUnder].legWins++;
            } else if (leg.won === false) {
              parlayStatOverUnderGroups[leg.statType][leg.overUnder].legLosses++;
            }
          }
        });
      }
    });
    
    // Generate insights for stat+over/under combinations in parlays
    Object.entries(parlayStatOverUnderGroups).forEach(([stat, overUnderData]) => {
      Object.entries(overUnderData).forEach(([overUnder, data]) => {
        const totalParlays = data.wins + data.losses;
        const totalLegs = data.legWins + data.legLosses;
        
        if (totalParlays >= 3) {
          const parlayWinRate = Math.round((data.wins / totalParlays) * 100);
          const legWinRate = totalLegs > 0 ? Math.round((data.legWins / totalLegs) * 100) : 0;
          const statName = formatStatName(stat);
          const overUnderLabel = overUnder.charAt(0).toUpperCase() + overUnder.slice(1);
          
          // High win rate when this stat+over/under is in parlays
          if (parlayWinRate >= 60 && totalParlays >= 3) {
            insights.push({
              id: `parlay-stat-overunder-win-${stat}-${overUnder}`,
              type: 'win',
              category: 'parlay',
              message: `When ${overUnderLabel} ${statName} is in your parlays, you win ${parlayWinRate}% of the time (${data.wins}W-${data.losses}L)`,
              priority: parlayWinRate * 5 + totalParlays * 3,
              color: 'green',
              stats: {
                wins: data.wins,
                losses: data.losses,
                total: totalParlays,
                winRate: parlayWinRate,
              },
              recommendation: `${overUnderLabel} ${statName} is a strong parlay performer. Consider including it more frequently in your parlay combinations.`,
            });
          }
          
          // Low win rate when this stat+over/under is in parlays
          if (parlayWinRate < 40 && data.losses >= 2 && totalParlays >= 3) {
            insights.push({
              id: `parlay-stat-overunder-loss-${stat}-${overUnder}`,
              type: 'loss',
              category: 'parlay',
              message: `When ${overUnderLabel} ${statName} is in your parlays, you lose ${100 - parlayWinRate}% of the time (${data.wins}W-${data.losses}L)`,
              priority: data.losses * 10 + totalParlays * 3,
              color: 'red',
              stats: {
                wins: data.wins,
                losses: data.losses,
                total: totalParlays,
                winRate: parlayWinRate,
              },
              recommendation: `${overUnderLabel} ${statName} is underperforming in your parlays (${legWinRate}% individual leg win rate). Consider removing it from parlay combinations.`,
            });
          }
        }
      });
    });
  }
  
  // === PAIN POINTS INSIGHTS (Near Misses) ===
  // These are excluded from "all" filter and only show when "pain" filter is selected
  
  const painInsights: Insight[] = [];
  
  // 1. Parlays that lost by exactly 1 leg
  const parlaysLostByOneLeg: JournalBet[] = [];
  parlayBets.forEach(bet => {
    if (bet.result === 'loss' && bet.parlay_legs && Array.isArray(bet.parlay_legs) && bet.parlay_legs.length > 1) {
      // Filter out legs where won is null/undefined
      const legs = bet.parlay_legs.filter(leg => leg && typeof leg === 'object' && (leg.won === true || leg.won === false));
      if (legs.length === 0) {
        // If no leg data, skip this bet for "lost by 1 leg" analysis
        return;
      }
      const wonLegs = legs.filter(leg => leg.won === true).length;
      const totalLegs = legs.length;
      const lostLegs = totalLegs - wonLegs;
      
      // Lost by exactly 1 leg (e.g., 2 leg parlay with 1 won = lost by 1, or 3 leg parlay with 2 won = lost by 1)
      // IMPORTANT: Only count as pain if lost by EXACTLY 1 leg
      if (totalLegs > 0 && lostLegs === 1) {
        console.log(`[Pain Insights] ✅ Found parlay lost by exactly 1 leg: ${wonLegs} won, ${lostLegs} lost out of ${totalLegs} total legs`);
        parlaysLostByOneLeg.push(bet);
      } else {
        console.log(`[Pain Insights] ❌ Parlay NOT pain (lost by ${lostLegs} legs, not 1): ${wonLegs} won, ${lostLegs} lost out of ${totalLegs} total legs`);
      }
    }
  });
  
  console.log(`[Pain Insights] Found ${parlaysLostByOneLeg.length} parlays lost by exactly 1 leg out of ${parlayBets.filter(b => b.result === 'loss').length} total lost parlays`);
  
  if (parlaysLostByOneLeg.length >= 1) {
    const totalWagered = getTotalWagered(parlaysLostByOneLeg);
    let potentialProfit = 0;
    parlaysLostByOneLeg.forEach(bet => {
      // Calculate what profit would have been if it won
      const potentialReturn = bet.stake * bet.odds;
      potentialProfit += potentialReturn - bet.stake;
    });
    
    painInsights.push({
      id: 'pain-parlays-lost-by-one',
      type: 'pain',
      category: 'parlay',
      message: `You've lost ${parlaysLostByOneLeg.length} parlay${parlaysLostByOneLeg.length > 1 ? 's' : ''} by exactly 1 leg`,
      priority: parlaysLostByOneLeg.length * 20,
      color: 'orange',
      stats: {
        losses: parlaysLostByOneLeg.length,
        total: parlaysLostByOneLeg.length,
        wagered: totalWagered,
      },
      relatedBets: parlaysLostByOneLeg,
      potentialProfit: potentialProfit,
      recommendation: `If these ${parlaysLostByOneLeg.length} parlay${parlaysLostByOneLeg.length > 1 ? 's' : ''} had hit, you would have made $${potentialProfit.toFixed(2)} more profit.`,
    });
  }
  
  // 2. Straight bets where player missed by exactly 0.5 (1 tick) - PAIN only
  const closeMisses: Array<{ bet: JournalBet; margin: number; potentialProfit: number }> = [];
  
  straightBets.forEach(bet => {
    if (bet.result === 'loss' && bet.actual_value !== null && bet.actual_value !== undefined && 
        bet.line !== null && bet.line !== undefined && bet.stat_type && bet.over_under) {
      const actual = bet.actual_value;
      const line = bet.line;
      let margin: number | null = null;
      
      if (bet.over_under === 'over') {
        margin = line - actual; // How much they missed by
      } else if (bet.over_under === 'under') {
        margin = actual - line; // How much they missed by
      }
      
      // Only track misses by exactly 0.5 (1 tick) - this is PAIN
      // Use small tolerance for floating point comparison (0.49 to 0.51)
      if (margin !== null && margin > 0 && margin >= 0.49 && margin <= 0.51) {
        const potentialReturn = bet.stake * bet.odds;
        const potentialProfit = potentialReturn - bet.stake;
        closeMisses.push({ bet, margin, potentialProfit });
      }
    }
  });
  
  // Group close misses by player (all are 0.5 misses - PAIN)
  const playerCloseMisses: Record<string, Array<{ bet: JournalBet; margin: number; potentialProfit: number }>> = {};
  closeMisses.forEach(miss => {
    const playerName = miss.bet.player_name || getPlayerName(miss.bet) || 'Unknown';
    if (!playerCloseMisses[playerName]) {
      playerCloseMisses[playerName] = [];
    }
    playerCloseMisses[playerName].push(miss);
  });
  
  // Generate insights for players with 2+ 0.5 misses (PAIN)
  // Only show player-specific insights if they have 2 or more misses
  Object.entries(playerCloseMisses).forEach(([player, misses]) => {
    if (misses.length >= 2) {
      const totalPotentialProfit = misses.reduce((sum, m) => sum + m.potentialProfit, 0);
      const statName = misses[0].bet.stat_type ? formatStatName(misses[0].bet.stat_type) : 'stat';
      
      painInsights.push({
        id: `pain-player-close-${player}`,
        type: 'pain',
        category: 'player',
        message: `${player} has missed ${statName} by 0.5 ${misses.length} time${misses.length > 1 ? 's' : ''}`,
        priority: misses.length * 20,
        color: 'orange',
        stats: {
          losses: misses.length,
          total: misses.length,
        },
        relatedBets: misses.map(m => m.bet),
        potentialProfit: totalPotentialProfit,
        recommendation: `If ${player} had hit these ${misses.length} bet${misses.length > 1 ? 's' : ''}, you would have made $${totalPotentialProfit.toFixed(2)} more.`,
      });
    }
  });
  
  // Only show general close misses insight if we have 3+ total 0.5 misses
  // This prevents duplication when there's only 1-2 misses (which would show player-specific if 2+)
  if (closeMisses.length >= 3) {
    const totalPotentialProfit = closeMisses.reduce((sum, m) => sum + m.potentialProfit, 0);
    
    painInsights.push({
      id: 'pain-general-close-misses',
      type: 'pain',
      category: 'bet_type',
      message: `You've had ${closeMisses.length} straight bet${closeMisses.length > 1 ? 's' : ''} miss by 0.5`,
      priority: closeMisses.length * 15,
      color: 'orange',
      stats: {
        losses: closeMisses.length,
        total: closeMisses.length,
      },
      relatedBets: closeMisses.map(m => m.bet),
      potentialProfit: totalPotentialProfit,
      recommendation: `If these ${closeMisses.length} close call${closeMisses.length > 1 ? 's' : ''} had hit, you would have made $${totalPotentialProfit.toFixed(2)} more.`,
    });
  }
  
  // No fallback insights - pain is only for specific near-misses:
  // 1. Parlays lost by exactly 1 leg
  // 2. Straight bets missed by exactly 0.5 (1 tick)
  
  // Add pain insights to main insights array (but they'll be filtered out from "all")
  insights.push(...painInsights);
  
  // Debug logging for pain insights
  if (painInsights.length > 0) {
    console.log(`[Pain Insights] Generated ${painInsights.length} pain insights:`, painInsights.map(i => ({ id: i.id, type: i.type, message: i.message, category: i.category, color: i.color })));
  } else {
    const lostParlays = parlayBets.filter(b => b.result === 'loss');
    const lostWithActualValue = straightBets.filter(b => b.result === 'loss' && b.actual_value !== null && b.actual_value !== undefined);
    console.log(`[Pain Insights] No pain insights generated. Lost parlays: ${lostParlays.length}, Lost straight bets with actual_value: ${lostWithActualValue.length}, Total parlay bets: ${parlayBets.length}, Total straight bets: ${straightBets.length}`);
    if (lostParlays.length > 0) {
      console.log(`[Pain Insights] Sample lost parlay:`, lostParlays[0]);
    }
  }
  
  // === COMPARISON INSIGHTS ===
  
  if (straightBets.length >= 5 && parlayBets.length >= 3) {
    const straightWins = straightBets.filter(b => b.result === 'win').length;
    const straightWinRate = Math.round((straightWins / straightBets.length) * 100);
    const parlayWins = parlayBets.filter(b => b.result === 'win').length;
    const parlayWinRate = Math.round((parlayWins / parlayBets.length) * 100);
    const difference = Math.abs(straightWinRate - parlayWinRate);
    
    if (difference >= 10) {
      const straightWagered = getTotalWagered(straightBets);
      const straightReturned = getTotalReturned(straightBets);
      const straightProfit = straightReturned - straightWagered;
      const straightROI = straightWagered > 0 ? Math.round((straightProfit / straightWagered) * 100) : 0;
      
      const parlayWagered = getTotalWagered(parlayBets);
      const parlayReturned = getTotalReturned(parlayBets);
      const parlayProfit = parlayReturned - parlayWagered;
      const parlayROI = parlayWagered > 0 ? Math.round((parlayProfit / parlayWagered) * 100) : 0;
      
      if (straightWinRate > parlayWinRate) {
        insights.push({
          id: 'comparison-straight-better',
          type: 'comparison',
          category: 'bet_type',
          message: getDeterministicMessage('comparison-straight-better', 'comparison', difference, straightWinRate, parlayWinRate, 'straight'),
          priority: difference * 10 + straightBets.length + parlayBets.length,
          color: 'blue',
          stats: {
            wins: straightBets.filter(b => b.result === 'win').length,
            losses: straightBets.filter(b => b.result === 'loss').length,
            total: straightBets.length,
            winRate: straightWinRate,
            profit: straightProfit,
            wagered: straightWagered,
            returned: straightReturned,
            roi: straightROI,
          },
          recommendation: `Straight bets are significantly outperforming parlays (${straightWinRate}% vs ${parlayWinRate}% win rate). Consider focusing more on straight bets.`,
        });
      } else {
        insights.push({
          id: 'comparison-parlay-better',
          type: 'comparison',
          category: 'bet_type',
          message: getDeterministicMessage('comparison-parlay-better', 'comparison', difference, straightWinRate, parlayWinRate, 'parlay'),
          priority: difference * 10 + straightBets.length + parlayBets.length,
          color: 'blue',
          stats: {
            wins: parlayBets.filter(b => b.result === 'win').length,
            losses: parlayBets.filter(b => b.result === 'loss').length,
            total: parlayBets.length,
            winRate: parlayWinRate,
            profit: parlayProfit,
            wagered: parlayWagered,
            returned: parlayReturned,
            roi: parlayROI,
          },
          recommendation: `Parlays are significantly outperforming straight bets (${parlayWinRate}% vs ${straightWinRate}% win rate). Consider incorporating more parlays into your strategy.`,
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
  const greenInsights = sortedInsights.filter(i => i.color === 'green');
  const yellowInsights = sortedInsights.filter(i => i.color === 'yellow');
  // Combine neutral and comparison insights (both use blue color) into info group
  const infoInsights = sortedInsights.filter(i => i.color === 'blue' && (i.type === 'neutral' || i.type === 'comparison'));
  // Orange insights (pain points) - these are excluded from "all" filter but kept in the array for when "pain" filter is selected
  const orangeInsights = sortedInsights.filter(i => i.color === 'orange' && i.type === 'pain');
  
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
  // NOTE: Orange (pain) insights are NOT added to finalInsights here - they're kept in the sortedInsights array
  // and will be available when the "pain" filter is selected. This way they don't appear in "all" view.
  const guaranteedRed = redInsights.slice(0, Math.min(2, redInsights.length));
  const guaranteedInfo = infoInsights.slice(0, Math.min(2, infoInsights.length));
  const guaranteedGreen = greenInsights.slice(0, Math.min(2, greenInsights.length));
  
  // Get remaining insights (after guaranteed ones)
  const remainingRed = redInsights.slice(guaranteedRed.length);
  const remainingInfo = infoInsights.slice(guaranteedInfo.length);
  const remainingGreen = greenInsights.slice(guaranteedGreen.length);
  
  // Create color groups with all insights (guaranteed + remaining)
  // Orange (pain) insights are NOT included here - they stay in the original sortedInsights array
  const colorGroups: Array<{ color: string; insights: Insight[] }> = [
    { color: 'red', insights: [...guaranteedRed, ...remainingRed] },
    { color: 'green', insights: [...guaranteedGreen, ...remainingGreen] },
    { color: 'info', insights: [...guaranteedInfo, ...remainingInfo] },
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
  // IMPORTANT: Include orange (pain) insights so they're available when "pain" filter is selected
  // They won't show in "all" due to filter logic, but need to be in the returned array
  const finalShuffled: Insight[] = [];
  // Include all finalInsights PLUS orange (pain) insights (they're excluded from finalInsights above)
  // orangeInsights is already defined above, so just reuse it
  const remaining = [...finalInsights, ...orangeInsights];
  
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
  
  // Insights filtering and UI state
  const [insightFilter, setInsightFilter] = useState<'all' | 'red' | 'green' | 'info' | 'yellow' | 'pain'>('all');
  const [insightBetTypeFilter, setInsightBetTypeFilter] = useState<'all' | 'straight' | 'parlay'>('all');
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());

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

    // EGRESS OPTIMIZATION: Limit to last 200 bets to reduce data transfer
    const { data, error } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(200);

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
            // Calculate settled bets FIRST before generating insights
            const settledBets = journalBets.filter(b => b.result === 'win' || b.result === 'loss');
            
            if (journalBets.length === 0) {
              return (
                <div className="p-4 text-center text-black dark:text-white opacity-70">
                  <div className="text-sm">No plays in journal yet</div>
                  <div className="text-xs mt-2">Add plays from the research pages to track your betting history</div>
                </div>
              );
            }
            
            // Check settled bets count FIRST - this takes priority over everything else
            // Don't even generate insights if we don't have enough settled bets
            if (settledBets.length < 10) {
              return (
                <div className="flex items-center justify-center h-full min-h-[200px] p-4">
                  <div className="text-center text-black dark:text-white opacity-70">
                    <div className="text-sm">You need 10 or more plays in the journal to get insights</div>
                    <div className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                      {settledBets.length}/10 plays
                    </div>
                  </div>
                </div>
              );
            }
            
            // Only generate insights if we have 10+ settled bets
            const insights = generateInsights(journalBets);
            
            // If no insights generated but we have 10+ settled bets, show a message
            if (insights.length === 0) {
              return (
                <div className="flex items-center justify-center h-full min-h-[200px] p-4">
                  <div className="text-center text-black dark:text-white opacity-70">
                    <div className="text-sm">You need 10 or more plays in the journal to get insights</div>
                    <div className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                      {settledBets.length}/10 plays
                    </div>
                  </div>
                </div>
              );
            }
            
            // Filter insights
            const filteredInsights = insights.filter(insight => {
              // Exclude pain insights from "all" filter - they only show when "pain" is explicitly selected
              if (insightFilter === 'all' && insight.type === 'pain') {
                return false;
              }
              
              if (insightFilter !== 'all') {
                if (insightFilter === 'info') {
                  // Information filter includes both neutral and comparison insights (both use blue color now)
                  if (insight.color !== 'blue' || (insight.type !== 'neutral' && insight.type !== 'comparison')) return false;
                } else if (insightFilter === 'pain') {
                  // Pain filter only shows pain type insights
                  if (insight.type !== 'pain') return false;
                } else {
                  if (insight.color !== insightFilter) return false;
                }
              }
              // Filter by bet type (straight vs parlay)
              if (insightBetTypeFilter !== 'all') {
                if (insightBetTypeFilter === 'parlay' && insight.category !== 'parlay') {
                  if (insight.type === 'pain') {
                    console.log(`[Pain Filter] ❌ Filtered out (not parlay category):`, insight.id, 'category:', insight.category);
                  }
                  return false;
                }
                if (insightBetTypeFilter === 'straight' && insight.category === 'parlay') {
                  if (insight.type === 'pain') {
                    console.log(`[Pain Filter] ❌ Filtered out (is parlay, filter wants straight):`, insight.id, 'category:', insight.category);
                  }
                  return false;
                }
              }
              
              // Debug: log pain insights that pass all filters
              if (insight.type === 'pain' && insightFilter === 'pain') {
                console.log(`[Pain Filter] ✅ INCLUDED:`, insight.id, insight.message, 'category:', insight.category, 'betTypeFilter:', insightBetTypeFilter);
              }
              
              return true;
            });
            
            // Debug summary
            if (insightFilter === 'pain') {
              const totalPainInsights = insights.filter(i => i.type === 'pain').length;
              console.log(`[Pain Filter] SUMMARY: ${filteredInsights.length} pain insights shown out of ${totalPainInsights} total. Filters: insightFilter="${insightFilter}", betTypeFilter="${insightBetTypeFilter}"`);
            }
            
            // Sort insights - when showing "All", interleave by color to ensure mixed display
            // When filtering by specific type, respect user's sort preference
            let sortedFilteredInsights: Insight[];
            
            if (insightFilter === 'all') {
              // When showing all, interleave insights by color for better mix
              // Combine orange (neutral) and blue (comparison) into 'info' group
              const colorGroups: Record<string, Insight[]> = {
                'red': [],
                'green': [],
                'info': [], // Combined neutral and comparison
                'yellow': []
              };
              
              // Group by color while maintaining priority within each color
              // Combine neutral and comparison insights (both blue) into 'info' group
              filteredInsights.forEach(insight => {
                if (insight.color === 'blue' && (insight.type === 'neutral' || insight.type === 'comparison')) {
                  if (!colorGroups['info']) colorGroups['info'] = [];
                  colorGroups['info'].push(insight);
                } else {
                  if (!colorGroups[insight.color]) colorGroups[insight.color] = [];
                  colorGroups[insight.color].push(insight);
                }
              });
              
              // Sort each color group by priority
              Object.keys(colorGroups).forEach(color => {
                colorGroups[color].sort((a, b) => b.priority - a.priority);
              });
              
              // Interleave: take one from each color group in round-robin fashion
              const interleaved: Insight[] = [];
              const maxLength = Math.max(...Object.values(colorGroups).map(g => g.length));
              
              for (let i = 0; i < maxLength; i++) {
                // Define color order for interleaving (red, green, info, yellow)
                const colorOrder = ['red', 'green', 'info', 'yellow'];
                
                // Shuffle the color order each round for better distribution
                const shuffledColors = [...colorOrder];
                if (i > 0) {
                  // Rotate colors each round
                  for (let j = 0; j < i % 4; j++) {
                    shuffledColors.push(shuffledColors.shift()!);
                  }
                }
                
                // Take one insight from each color if available
                for (const color of shuffledColors) {
                  if (colorGroups[color] && colorGroups[color].length > i) {
                    interleaved.push(colorGroups[color][i]);
                  }
                }
              }
              
              sortedFilteredInsights = interleaved;
            } else {
              // When filtering by specific type, always sort by priority
              sortedFilteredInsights = [...filteredInsights].sort((a, b) => {
                return b.priority - a.priority;
              });
            }
            
            const toggleInsight = (id: string) => {
              setExpandedInsights(prev => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                return next;
              });
            };
            
            return (
              <div className="p-4">
                {/* Filters and Sorting */}
                <div className="mb-4 space-y-2">
                  <div className="grid grid-cols-5 gap-2">
                    <button
                      onClick={() => setInsightFilter('all')}
                      className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                        insightFilter === 'all'
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setInsightFilter('green')}
                      className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                        insightFilter === 'green'
                          ? 'bg-green-500 text-white'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
                      }`}
                    >
                      Wins
                    </button>
                    <button
                      onClick={() => setInsightFilter('red')}
                      className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                        insightFilter === 'red'
                          ? 'bg-red-500 text-white'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50'
                      }`}
                    >
                      Losses
                    </button>
                    <button
                      onClick={() => setInsightFilter('info')}
                      className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                        insightFilter === 'info'
                          ? 'bg-blue-500 text-white'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                      }`}
                    >
                      Info
                    </button>
                    <button
                      onClick={() => setInsightFilter('pain')}
                      className={`text-xs px-2 py-2 rounded-lg transition-colors font-medium ${
                        insightFilter === 'pain'
                          ? 'bg-orange-500 text-white'
                          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50'
                      }`}
                    >
                      Pain
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setInsightBetTypeFilter('all')}
                        className={`text-xs px-2 py-1 rounded-lg transition-colors font-medium ${
                          insightBetTypeFilter === 'all'
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setInsightBetTypeFilter('straight')}
                        className={`text-xs px-2 py-1 rounded-lg transition-colors font-medium ${
                          insightBetTypeFilter === 'straight'
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        Straight
                      </button>
                      <button
                        onClick={() => setInsightBetTypeFilter('parlay')}
                        className={`text-xs px-2 py-1 rounded-lg transition-colors font-medium ${
                          insightBetTypeFilter === 'parlay'
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        Parlays
                      </button>
                    </div>
                  </div>
                  
                  {filteredInsights.length !== insights.length && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Showing {filteredInsights.length} of {insights.length} insights
                    </div>
                  )}
                </div>
                
                {/* Insights List */}
                <div className="space-y-3">
                  {sortedFilteredInsights.length === 0 ? (
                    <div className="p-4 text-center text-black dark:text-white opacity-70">
                      <div className="text-sm">No insights match your filters</div>
                      <button
                        onClick={() => {
                          setInsightFilter('all');
                          setInsightBetTypeFilter('all');
                        }}
                        className="text-xs mt-2 text-purple-500 dark:text-purple-400 hover:underline"
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : (
                    sortedFilteredInsights.map((insight) => {
                  const getColorClasses = () => {
                    switch (insight.color) {
                      case 'red':
                        return {
                          border: 'border-red-500 dark:border-red-400',
                          text: 'text-slate-900 dark:text-white',
                          iconBg: 'bg-red-50 dark:bg-red-950/20',
                          iconColor: 'text-red-600 dark:text-red-400',
                        };
                      case 'green':
                        return {
                          border: 'border-green-500 dark:border-green-400',
                          text: 'text-slate-900 dark:text-white',
                          iconBg: 'bg-green-50 dark:bg-green-950/20',
                          iconColor: 'text-green-600 dark:text-green-400',
                        };
                      case 'blue':
                        return {
                          border: 'border-blue-500 dark:border-blue-400',
                          text: 'text-slate-900 dark:text-white',
                          iconBg: 'bg-blue-50 dark:bg-blue-950/20',
                          iconColor: 'text-blue-600 dark:text-blue-400',
                        };
                      case 'yellow':
                        return {
                          border: 'border-yellow-500 dark:border-yellow-400',
                          text: 'text-slate-900 dark:text-white',
                          iconBg: 'bg-yellow-50 dark:bg-yellow-950/20',
                          iconColor: 'text-yellow-600 dark:text-yellow-400',
                        };
                      case 'orange':
                        return {
                          border: 'border-orange-500 dark:border-orange-400',
                          text: 'text-slate-900 dark:text-white',
                          iconBg: 'bg-orange-50 dark:bg-orange-950/20',
                          iconColor: 'text-orange-600 dark:text-orange-400',
                        };
                      default:
                        return {
                          border: 'border-gray-500 dark:border-gray-400',
                          text: 'text-slate-900 dark:text-white',
                          iconBg: 'bg-gray-50 dark:bg-gray-800',
                          iconColor: 'text-gray-600 dark:text-gray-400',
                        };
                    }
                  };
                  
                  const getIcon = () => {
                    const iconClass = `w-4 h-4 ${colors.iconColor}`;
                    switch (insight.type) {
                      case 'loss':
                        return <TrendingDown className={iconClass} />;
                      case 'win':
                        return <TrendingUp className={iconClass} />;
                      case 'comparison':
                        return <BarChart3 className={iconClass} />;
                      case 'streak':
                        return <TrendingUp className={iconClass} />;
                      case 'neutral':
                        return <Minus className={iconClass} />;
                      case 'pain':
                        return <span className={iconClass} style={{ fontSize: '16px' }}>😢</span>;
                      default:
                        return <Lightbulb className={iconClass} />;
                    }
                  };
                  
                      const colors = getColorClasses();
                      const isExpanded = expandedInsights.has(insight.id);
                      const isPainInsight = insight.type === 'pain';
                      
                      return (
                        <div
                          key={insight.id}
                          className={`rounded-lg bg-slate-50 dark:bg-[#0a1929] border-2 ${colors.border} shadow-sm hover:shadow-md transition-all ${isExpanded ? 'ring-1 ring-slate-400 dark:ring-gray-500' : ''}`}
                        >
                          <div className="p-4">
                            <div className="flex items-start gap-3">
                              <div className={`flex-shrink-0 w-8 h-8 rounded-md ${colors.iconBg} flex items-center justify-center`}>
                                {getIcon()}
                              </div>
                              <div className="flex-1 min-w-0">
                                {isPainInsight ? (
                                  // Pain insights: single line, no dropdown
                                  <div className="space-y-1">
                                    <p className={`text-sm font-medium leading-relaxed ${colors.text}`}>
                                      {insight.message}
                                    </p>
                                    {insight.potentialProfit !== undefined && (
                                      <p className="text-xs text-orange-600 dark:text-orange-400">
                                        If they had hit, you would have made ${insight.potentialProfit.toFixed(2)} more profit.
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  // Regular insights: with expand/collapse
                                  <>
                                    <div className="flex items-start justify-between gap-2">
                                      <p className={`text-sm font-medium leading-relaxed ${colors.text}`}>
                                        {insight.message}
                                      </p>
                                      <button
                                        onClick={() => toggleInsight(insight.id)}
                                        className="flex-shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                        title={isExpanded ? 'Collapse' : 'Expand for details'}
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="w-4 h-4" />
                                        ) : (
                                          <ChevronDown className="w-4 h-4" />
                                        )}
                                      </button>
                                    </div>
                                    
                                    {/* Expanded Details - only for non-pain insights */}
                                    {isExpanded && (insight.stats || insight.potentialProfit !== undefined || insight.recommendation) && (
                                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2 animate-in slide-in-from-top-2 duration-200">
                                    {insight.stats && insight.stats.winRate !== undefined && (
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="opacity-75">Win Rate:</span>
                                        <div className="flex items-center gap-2">
                                          <div className="w-20 bg-current/20 rounded-full h-1.5">
                                            <div
                                              className={`h-1.5 rounded-full transition-all ${
                                                insight.stats.winRate >= 60 ? 'bg-green-500' :
                                                insight.stats.winRate >= 50 ? 'bg-yellow-500' :
                                                'bg-red-500'
                                              }`}
                                              style={{ width: `${insight.stats.winRate}%` }}
                                            />
                                          </div>
                                          <span className="font-bold">{insight.stats.winRate}%</span>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {insight.stats && (insight.stats.wins !== undefined || insight.stats.losses !== undefined) && (
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="opacity-75">Record:</span>
                                        <span className="font-bold">
                                          {insight.stats.wins || 0}W - {insight.stats.losses || 0}L
                                          {insight.stats.total !== undefined && ` (${insight.stats.total} total)`}
                                        </span>
                                      </div>
                                    )}
                                    
                                    {insight.stats && insight.stats.profit !== undefined && (
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="opacity-75">Profit:</span>
                                        <span className={`font-bold ${insight.stats.profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                          ${insight.stats.profit >= 0 ? '+' : ''}{insight.stats.profit.toFixed(2)}
                                        </span>
                                      </div>
                                    )}
                                    
                                    {insight.stats && insight.stats.roi !== undefined && (
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="opacity-75">ROI:</span>
                                        <span className={`font-bold ${insight.stats.roi >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {insight.stats.roi >= 0 ? '+' : ''}{insight.stats.roi}%
                                        </span>
                                      </div>
                                    )}
                                    
                                    {insight.potentialProfit !== undefined && (
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="opacity-75">Potential Profit (if hit):</span>
                                        <span className="font-bold text-orange-600 dark:text-orange-400">
                                          +${insight.potentialProfit.toFixed(2)}
                                        </span>
                                      </div>
                                    )}
                                    
                                    {insight.recommendation && (
                                      <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Recommendation:</div>
                                        <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{insight.recommendation}</div>
                                      </div>
                                    )}
                                  </div>
                                  )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>
      
    </div>
  );
}
