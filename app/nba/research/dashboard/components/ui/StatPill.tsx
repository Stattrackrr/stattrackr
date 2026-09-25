'use client';

import { memo, useCallback } from 'react';

export default memo(function StatPill({
  label,
  value,
  isSelected,
  onSelect,
  isDark,
  darker,
  disabled = false,
}: {
  label: string;
  value: string;
  isSelected: boolean;
  onSelect: (v: string) => void;
  isDark: boolean;
  /** When true, use darker unselected background in dark mode (e.g. AFL chart). */
  darker?: boolean;
  disabled?: boolean;
}) {
  const onClick = useCallback(() => {
    if (disabled) return;
    onSelect(value);
  }, [disabled, onSelect, value]);
  const unselectedClass = isDark && darker
    ? 'bg-gray-900 text-gray-200 border border-gray-700'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
  const unselectedHover = isDark && darker
    ? 'hover:bg-gray-800'
    : 'hover:bg-gray-200 dark:hover:bg-gray-600';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={disabled || undefined}
      className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap ${
        isSelected
          ? 'bg-purple-600 text-white'
          : disabled
            ? 'cursor-not-allowed border border-gray-700/40 bg-[#0a1929] text-gray-500 opacity-45'
            : `${unselectedClass} ${unselectedHover}`
      }`}
    >
      {label}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.label === next.label && prev.value === next.value && prev.isDark === next.isDark && prev.darker === next.darker && prev.disabled === next.disabled);






