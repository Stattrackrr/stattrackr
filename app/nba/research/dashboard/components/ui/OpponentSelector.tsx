'use client';

import { memo, useState } from 'react';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { ABBR_TO_TEAM_ID, getEspnLogoCandidates } from '../../constants';

export default memo(function OpponentSelector({ 
  currentOpponent, 
  manualOpponent, 
  onOpponentChange, 
  isDark,
  propsMode,
  currentTeam,
  selectedTimeframe 
}: { 
  currentOpponent: string;
  manualOpponent: string;
  onOpponentChange: (opponent: string) => void;
  isDark: boolean;
  propsMode: string;
  currentTeam: string;
  selectedTimeframe: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [logoAttempts, setLogoAttempts] = useState<Record<string, number>>({});
  const allTeams = Object.keys(ABBR_TO_TEAM_ID).filter(team => team !== normalizeAbbr(currentTeam));
  
  const displayValue = (() => {
    if (manualOpponent) return manualOpponent;
    if (selectedTimeframe === 'h2h' && currentOpponent) return currentOpponent;
    return 'ALL';
  })();
  
  const options = [
    { value: 'ALL', label: 'ALL' },
    ...(currentOpponent ? [{ value: currentOpponent, label: currentOpponent }] : []),
    ...allTeams.sort().map(team => ({ value: team, label: team }))
  ].filter((option, index, array) => 
    array.findIndex(o => o.value === option.value) === index
  );
  
  const handleSelect = (value: string) => {
    onOpponentChange(value);
    setIsOpen(false);
  };

  return (
    <div className="flex items-center gap-1 relative">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">VS</span>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-16 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm sm:text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          <div className="flex items-center gap-1">
            {displayValue !== 'ALL' && (
              <img 
                src={(() => {
                  const candidates = getEspnLogoCandidates(displayValue);
                  const attempt = logoAttempts[`trigger-${displayValue}`] || 0;
                  return candidates[attempt] || candidates[0];
                })()} 
                alt={displayValue}
                className="w-5 h-5 object-contain"
                onError={(e) => {
                  const candidates = getEspnLogoCandidates(displayValue);
                  const currentAttempt = logoAttempts[`trigger-${displayValue}`] || 0;
                  const nextAttempt = currentAttempt + 1;
                  if (nextAttempt < candidates.length) {
                    setLogoAttempts(prev => ({ ...prev, [`trigger-${displayValue}`]: nextAttempt }));
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
            )}
            <span className="text-sm font-medium">{displayValue}</span>
          </div>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-20 sm:w-24 md:w-28 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto custom-scrollbar">
            {options.map(option => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className="w-full px-2 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg last:rounded-b-lg flex items-center justify-center gap-1"
              >
                {option.value !== 'ALL' && (
                  <img 
                    src={(() => {
                      const candidates = getEspnLogoCandidates(option.value);
                      const attempt = logoAttempts[`option-${option.value}`] || 0;
                      return candidates[attempt] || candidates[0];
                    })()} 
                    alt={option.value}
                    className="w-5 h-5 object-contain"
                    onError={(e) => {
                      const candidates = getEspnLogoCandidates(option.value);
                      const currentAttempt = logoAttempts[`option-${option.value}`] || 0;
                      const nextAttempt = currentAttempt + 1;
                      if (nextAttempt < candidates.length) {
                        setLogoAttempts(prev => ({ ...prev, [`option-${option.value}`]: nextAttempt }));
                      } else {
                        e.currentTarget.style.display = 'none';
                      }
                    }}
                  />
                )}
                <span className="text-sm font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}, (prev, next) => 
  prev.currentOpponent === next.currentOpponent && 
  prev.manualOpponent === next.manualOpponent && 
  prev.isDark === next.isDark &&
  prev.currentTeam === next.currentTeam &&
  prev.selectedTimeframe === next.selectedTimeframe
);






