'use client';

import { memo, useCallback } from 'react';

export default memo(function StatPill({
  label,
  value,
  isSelected,
  onSelect,
  isDark,
  darker,
}: {
  label: string;
  value: string;
  isSelected: boolean;
  onSelect: (v: string) => void;
  isDark: boolean;
  /** When true, use darker unselected background in dark mode (e.g. AFL chart). */
  darker?: boolean;
}) {
  const onClick = useCallback(() => onSelect(value), [onSelect, value]);
  const unselectedClass = isDark && darker
    ? 'bg-gray-900 text-gray-200 hover:bg-gray-800 border border-gray-700'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600';
  return (
    <button
      onClick={onClick}
      className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
        isSelected ? 'bg-purple-600 text-white' : unselectedClass
      }`}
    >
      {label}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.label === next.label && prev.value === next.value && prev.isDark === next.isDark && prev.darker === next.darker);






