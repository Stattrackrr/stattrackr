/**
 * Header info processing utilities
 * 
 * This file contains the logic for generating header information
 * (player/team name, jersey, team, height) based on props mode.
 */

import { TEAM_FULL_NAMES } from './teamUtils';
import { formatHeight } from '@/lib/nbaPlayers';
import { NBAPlayer } from '../types';

export interface HeaderInfo {
  name: string;
  jersey: string;
  team: string;
  teamName: string;
  height: string;
}

export interface HeaderInfoParams {
  propsMode: 'player' | 'team';
  gamePropsTeam?: string;
  selectedPlayer: NBAPlayer | null;
  selectedTeam: string | null;
}

/**
 * Generates header information based on props mode (player or team)
 */
export function calculateHeaderInfo({
  propsMode,
  gamePropsTeam,
  selectedPlayer,
  selectedTeam,
}: HeaderInfoParams): HeaderInfo {
  if (propsMode === 'team') {
    // Game Props mode - show team info or prompt
    if (gamePropsTeam && gamePropsTeam !== 'N/A') {
      return {
        name: TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam,
        jersey: '',
        team: gamePropsTeam,
        teamName: TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam,
        height: ''
      };
    } else {
      return {
        name: 'Select a team',
        jersey: '',
        team: '',
        teamName: '',
        height: ''
      };
    }
  } else {
    // Player Props mode - show player info
    return {
      name: selectedPlayer?.full || 'Select a player',
      jersey: selectedPlayer ? `#${(selectedPlayer as any).jersey || ''}` : '',
      team: selectedTeam && selectedTeam !== 'N/A' ? selectedTeam : (selectedPlayer?.teamAbbr || ''),
      teamName: selectedTeam && selectedTeam !== 'N/A' 
        ? TEAM_FULL_NAMES[selectedTeam] || selectedTeam 
        : (selectedPlayer?.teamAbbr ? TEAM_FULL_NAMES[selectedPlayer.teamAbbr] || selectedPlayer.teamAbbr : ''),
      height: selectedPlayer ? (
        formatHeight((selectedPlayer as any).heightFeet, (selectedPlayer as any).heightInches) !== 'N/A' 
          ? formatHeight((selectedPlayer as any).heightFeet, (selectedPlayer as any).heightInches)
          : (selectedPlayer as any).rawHeight || 'N/A'
      ) : ''
    };
  }
}

