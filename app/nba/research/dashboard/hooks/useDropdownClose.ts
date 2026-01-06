import { useEffect, RefObject } from 'react';

export interface UseDropdownCloseParams {
  searchRef: RefObject<HTMLDivElement | null>;
  setShowDropdown: (show: boolean) => void;
}

/**
 * Custom hook to close dropdown on outside click
 */
export function useDropdownClose({
  searchRef,
  setShowDropdown,
}: UseDropdownCloseParams) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the search container (includes dropdown)
      // The button handlers will close the dropdown themselves
      if (searchRef.current && searchRef.current.contains(target)) {
        return; // Click is inside search container
      }
      // Click is outside - close dropdown
      setShowDropdown(false);
    };
    // Use a slight delay to ensure button onClick handlers fire first
    const handleClick = (e: MouseEvent) => {
      // Use requestAnimationFrame to defer the check until after button handlers
      requestAnimationFrame(() => {
        onClick(e);
      });
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [searchRef, setShowDropdown]);
}

