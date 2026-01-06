'use client';

import { useState, useRef } from 'react';

export function useDashboardUIState() {
  // User profile state
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false); // Default to false until verified
  
  // Dropdown menu state
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  // Advanced filters (player mode)
  const [minMinutesFilter, setMinMinutesFilter] = useState<number>(0);
  const [maxMinutesFilter, setMaxMinutesFilter] = useState<number>(48);
  const [excludeBlowouts, setExcludeBlowouts] = useState<boolean>(false);
  const [excludeBackToBack, setExcludeBackToBack] = useState<boolean>(false);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState<boolean>(false);
  const [isMinutesFilterOpen, setIsMinutesFilterOpen] = useState<boolean>(false);

  // Journal modal state
  const [showJournalModal, setShowJournalModal] = useState(false);

  // Sidebar toggle state for tablets/Macs
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return {
    // User profile
    userEmail,
    setUserEmail,
    username,
    setUsername,
    avatarUrl,
    setAvatarUrl,
    isPro,
    setIsPro,
    // Dropdown menus
    showJournalDropdown,
    setShowJournalDropdown,
    journalDropdownRef,
    showProfileDropdown,
    setShowProfileDropdown,
    profileDropdownRef,
    showSettingsDropdown,
    setShowSettingsDropdown,
    settingsDropdownRef,
    // Advanced filters
    minMinutesFilter,
    setMinMinutesFilter,
    maxMinutesFilter,
    setMaxMinutesFilter,
    excludeBlowouts,
    setExcludeBlowouts,
    excludeBackToBack,
    setExcludeBackToBack,
    isAdvancedFiltersOpen,
    setIsAdvancedFiltersOpen,
    isMinutesFilterOpen,
    setIsMinutesFilterOpen,
    // UI state
    showJournalModal,
    setShowJournalModal,
    sidebarOpen,
    setSidebarOpen,
  };
}

