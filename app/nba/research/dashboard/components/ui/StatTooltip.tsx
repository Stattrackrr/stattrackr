'use client';

import { useState } from 'react';

export default function StatTooltip({ 
  statName, 
  value, 
  definition 
}: { 
  statName: string; 
  value: React.ReactNode; 
  definition?: string 
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-1 relative">
        <span className="text-xs text-gray-700 dark:text-gray-300">{statName}</span>
        {definition && (
          <>
            <button
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className="w-2.5 h-2.5 rounded-full text-[10px] font-bold flex items-center justify-center bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
            >
              ?
            </button>
            {showTooltip && (
              <div className="absolute z-50 left-0 bottom-5 w-32 px-2 py-1.5 text-xs leading-relaxed rounded border shadow-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                {definition}
              </div>
            )}
          </>
        )}
      </div>
      {value}
    </div>
  );
}






