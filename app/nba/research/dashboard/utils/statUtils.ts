import { BallDontLieStats } from '../types';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { parseMinutes } from './playerUtils';

// Player stats from BallDontLie stats API
export function getStatValue(stats: BallDontLieStats, key: string): number {
  switch (key) {
    case 'min': return parseMinutes(stats.min);
    case 'pts': return stats.pts;
    case 'reb': return stats.reb;
    case 'ast': return stats.ast;
    case 'fg3m': return stats.fg3m;
    case 'fg3a': return stats.fg3a;
    case 'fg3_pct': return (stats.fg3_pct || 0) * 100;
    case 'fgm': return stats.fgm;
    case 'fga': return stats.fga;
    case 'fg_pct': return (stats.fg_pct || 0) * 100;
    case 'ftm': return stats.ftm;
    case 'fta': return stats.fta;
    case 'ft_pct': return (stats.ft_pct || 0) * 100;
    case 'oreb': return stats.oreb;
    case 'dreb': return stats.dreb;
    case 'double_double': {
      const count = [stats.pts, stats.reb, stats.ast, stats.stl ?? 0, stats.blk ?? 0].filter(v => (v || 0) >= 10).length;
      return count >= 2 ? 1 : 0;
    }
    case 'triple_double': {
      const count = [stats.pts, stats.reb, stats.ast, stats.stl ?? 0, stats.blk ?? 0].filter(v => (v || 0) >= 10).length;
      return count >= 3 ? 1 : 0;
    }
    case 'turnover': return stats.turnover;
    case 'pf': return stats.pf;
    case 'stl': return stats.stl ?? 0; // Default to 0 if null/undefined
    case 'blk': return stats.blk ?? 0; // Default to 0 if null/undefined
    // Composite stats
    case 'pra': return (stats.pts || 0) + (stats.reb || 0) + (stats.ast || 0);
    case 'pr': return (stats.pts || 0) + (stats.reb || 0);
    case 'pa': return (stats.pts || 0) + (stats.ast || 0);
    case 'ra': return (stats.reb || 0) + (stats.ast || 0);
    default: return 0;
  }
}

// Game-level stats from BallDontLie games API
export function getGameStatValue(game: any, key: string, teamAbbr: string): number {
  if (!game) return 0;
  
  const homeScore = game.home_team_score || 0;
  const visitorScore = game.visitor_team_score || 0;
  const homeTeam = game.home_team?.abbreviation;
  const visitorTeam = game.visitor_team?.abbreviation;
  const normalizedTeam = normalizeAbbr(teamAbbr);
  const isHome = normalizeAbbr(homeTeam || '') === normalizedTeam;
  
  switch (key) {
    case 'total_pts':
      return homeScore + visitorScore;
    
    case 'spread':
      // Betting research logic: calculate from selected team's perspective
      // Show wins as negative (down) and losses as positive (up)
      const selectedTeamScore = isHome ? homeScore : visitorScore;
      const opponentScore = isHome ? visitorScore : homeScore;
      const margin = selectedTeamScore - opponentScore;
      // Positive margin = win; Negative margin = loss
      // Invert so wins plot downward (negative) and losses upward (positive)
      return -margin;
    
    case 'moneyline':
      // 1 = win, 0 = loss
      return isHome ? (homeScore > visitorScore ? 1 : 0) : (visitorScore > homeScore ? 1 : 0);
    
    case 'home_total':
      return homeScore;
    
    case 'away_total':
      return visitorScore;
    
    case 'first_half_total':
      return (game.home_q1 || 0) + (game.home_q2 || 0) + (game.visitor_q1 || 0) + (game.visitor_q2 || 0);
    
    case 'second_half_total':
      return (game.home_q3 || 0) + (game.home_q4 || 0) + (game.visitor_q3 || 0) + (game.visitor_q4 || 0);
    
    case 'q1_total':
      return (game.home_q1 || 0) + (game.visitor_q1 || 0);
    
    case 'q2_total':
      return (game.home_q2 || 0) + (game.visitor_q2 || 0);
    
    case 'q3_total':
      return (game.home_q3 || 0) + (game.visitor_q3 || 0);
    
    case 'q4_total':
      return (game.home_q4 || 0) + (game.visitor_q4 || 0);
    
    case 'q1_moneyline':
      // 1 = won quarter, 0 = lost quarter
      const homeQ1 = game.home_q1 || 0;
      const visitorQ1 = game.visitor_q1 || 0;
      return isHome ? (homeQ1 > visitorQ1 ? 1 : 0) : (visitorQ1 > homeQ1 ? 1 : 0);
    
    case 'q2_moneyline':
      const homeQ2 = game.home_q2 || 0;
      const visitorQ2 = game.visitor_q2 || 0;
      return isHome ? (homeQ2 > visitorQ2 ? 1 : 0) : (visitorQ2 > homeQ2 ? 1 : 0);
    
    case 'q3_moneyline':
      const homeQ3 = game.home_q3 || 0;
      const visitorQ3 = game.visitor_q3 || 0;
      return isHome ? (homeQ3 > visitorQ3 ? 1 : 0) : (visitorQ3 > homeQ3 ? 1 : 0);
    
    case 'q4_moneyline':
      const homeQ4 = game.home_q4 || 0;
      const visitorQ4 = game.visitor_q4 || 0;
      return isHome ? (homeQ4 > visitorQ4 ? 1 : 0) : (visitorQ4 > homeQ4 ? 1 : 0);
    
    default:
      return 0;
  }
}
