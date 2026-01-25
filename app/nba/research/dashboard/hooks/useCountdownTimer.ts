import { useEffect } from 'react';

export interface UseCountdownTimerParams {
  nextGameTipoff: Date | null;
  isGameInProgress: boolean;
  setCountdown: (countdown: { hours: number; minutes: number; seconds: number } | null) => void;
}

/**
 * Custom hook to update countdown timer every second
 */
export function useCountdownTimer({
  nextGameTipoff,
  isGameInProgress,
  setCountdown,
}: UseCountdownTimerParams) {
  useEffect(() => {
    if (!nextGameTipoff || isGameInProgress) {
      setCountdown(null);
      return;
    }
    
    const updateCountdown = () => {
      const now = new Date().getTime();
      const tipoff = nextGameTipoff.getTime();
      const diff = tipoff - now;
      
      if (diff <= 0) {
        setCountdown(null);
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setCountdown({ hours, minutes, seconds });
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, [nextGameTipoff, isGameInProgress, setCountdown]);
}


