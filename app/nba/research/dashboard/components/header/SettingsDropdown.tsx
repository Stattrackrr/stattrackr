'use client';

import { setLocalStorage } from '../../utils/storageUtils';

interface SettingsDropdownProps {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  theme: 'Light' | 'Dark';
  oddsFormat: 'american' | 'decimal';
  setTheme: (theme: 'Light' | 'Dark') => void;
  setOddsFormat: (format: 'american' | 'decimal') => void;
}

export function SettingsDropdown({ 
  dropdownRef, 
  theme, 
  oddsFormat, 
  setTheme, 
  setOddsFormat 
}: SettingsDropdownProps) {
  return (
    <div ref={dropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
      <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
        {/* Theme Selection */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</label>
          <select 
            value={theme}
            onChange={(e) => {
              const newTheme = e.target.value as 'Light' | 'Dark';
              setTheme(newTheme);
              setLocalStorage('theme', newTheme);
            }}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          >
            <option value="Light">Light</option>
            <option value="Dark">Dark</option>
          </select>
        </div>
        
        {/* Odds Format Selection */}
        <div className="px-4 py-3">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Odds Format</label>
          <select 
            value={oddsFormat}
            onChange={(e) => {
              const newFormat = e.target.value as 'american' | 'decimal';
              setOddsFormat(newFormat);
              setLocalStorage('oddsFormat', newFormat);
            }}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          >
            <option value="american">American</option>
            <option value="decimal">Decimal</option>
          </select>
        </div>
      </div>
    </div>
  );
}

