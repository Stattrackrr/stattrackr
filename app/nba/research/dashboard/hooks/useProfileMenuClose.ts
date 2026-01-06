import { useEffect, RefObject } from 'react';

export interface UseProfileMenuCloseParams {
  journalDropdownRef: RefObject<HTMLElement | null>;
  profileDropdownRef: RefObject<HTMLElement | null>;
  settingsDropdownRef: RefObject<HTMLElement | null>;
  setShowJournalDropdown: (show: boolean) => void;
  setShowProfileDropdown: (show: boolean) => void;
  setShowSettingsDropdown: (show: boolean) => void;
}

/**
 * Custom hook to close profile menu when clicking outside
 */
export function useProfileMenuClose({
  journalDropdownRef,
  profileDropdownRef,
  settingsDropdownRef,
  setShowJournalDropdown,
  setShowProfileDropdown,
  setShowSettingsDropdown,
}: UseProfileMenuCloseParams) {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        journalDropdownRef.current &&
        !journalDropdownRef.current.contains(target) &&
        !target.closest('[data-journal-button]')
      ) {
        setShowJournalDropdown(false);
      }
      if (
        profileDropdownRef.current &&
        !profileDropdownRef.current.contains(target) &&
        !target.closest('[data-profile-button]')
      ) {
        setShowProfileDropdown(false);
      }
      if (
        settingsDropdownRef.current &&
        !settingsDropdownRef.current.contains(target) &&
        !target.closest('[data-settings-button]')
      ) {
        setShowSettingsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [journalDropdownRef, profileDropdownRef, settingsDropdownRef, setShowJournalDropdown, setShowProfileDropdown, setShowSettingsDropdown]);
}


