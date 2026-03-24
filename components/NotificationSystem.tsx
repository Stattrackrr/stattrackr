'use client';

import { useEffect } from 'react';

const NOTIFICATION_STORAGE_KEY = 'stattrackr-notifications';
const POPUP_SHOWN_KEY = 'stattrackr-popup-shown';

export default function NotificationSystem({ isDark: _isDark }: { isDark: boolean }) {
  // Notifications are intentionally disabled for all users.
  // We also clear legacy client-side notification state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(NOTIFICATION_STORAGE_KEY);
      localStorage.removeItem(POPUP_SHOWN_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  return null;
}
