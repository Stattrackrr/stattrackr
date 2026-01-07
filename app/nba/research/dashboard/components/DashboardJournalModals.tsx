'use client';

import { Suspense, lazy } from 'react';
import { NBAPlayer } from '../types';
import { TEAM_FULL_NAMES } from '../utils/teamUtils';
import { OddsFormat } from '../types';

// Lazy load modal component
const AddToJournalModal = lazy(() => import('@/components/AddToJournalModal').then(mod => ({ default: mod.default })));

interface DashboardJournalModalsProps {
  propsMode: 'player' | 'team';
  selectedPlayer: NBAPlayer | null;
  opponentTeam: string | null;
  gamePropsTeam: string;
  selectedTeam: string;
  nextGameOpponent: string | null;
  nextGameDate: string | null;
  oddsFormat: OddsFormat;
  showJournalModal: boolean;
  setShowJournalModal: (show: boolean) => void;
}

export function DashboardJournalModals({
  propsMode,
  selectedPlayer,
  opponentTeam,
  gamePropsTeam,
  selectedTeam,
  nextGameOpponent,
  nextGameDate,
  oddsFormat,
  showJournalModal,
  setShowJournalModal,
}: DashboardJournalModalsProps) {
  return (
    <>
      {/* Journal Modals */}
      {propsMode === 'player' && selectedPlayer && opponentTeam && nextGameOpponent && nextGameDate && (
        <Suspense fallback={null}>
          <AddToJournalModal
            isOpen={showJournalModal}
            onClose={() => setShowJournalModal(false)}
            playerName={selectedPlayer.full || ''}
            playerId={String(selectedPlayer.id)}
            team={selectedTeam}
            opponent={nextGameOpponent}
            gameDate={nextGameDate}
            oddsFormat={oddsFormat}
          />
        </Suspense>
      )}
      
      {/* Game Props Journal Modals */}
      {propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam && nextGameDate && (
        <Suspense fallback={null}>
          <AddToJournalModal
            isOpen={showJournalModal}
            onClose={() => setShowJournalModal(false)}
            playerName={TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam}
            playerId={gamePropsTeam}
            team={gamePropsTeam}
            opponent={opponentTeam}
            gameDate={nextGameDate}
            oddsFormat={oddsFormat}
            isGameProp={true}
          />
        </Suspense>
      )}
    </>
  );
}

