'use client';

import { memo, useCallback } from 'react';

export default memo(function TimeframeBtn({ 
  value, 
  isSelected, 
  onSelect 
}: { 
  value: string; 
  isSelected: boolean; 
  onSelect: (v: string) => void 
}) {
  const onClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <button
      onClick={onClick}
      className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
        isSelected ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {value === 'h2h' ? 'H2H' : value === 'lastseason' ? 'Last Season' : value === 'thisseason' ? 'This Season' : value.replace('last','L')}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.value === next.value);




