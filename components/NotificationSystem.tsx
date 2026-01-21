'use client';

import { useState, useEffect } from 'react';
import { X, Bell } from 'lucide-react';

interface Notification {
  id: string;
  title: string;
  content: string;
  date: string;
  read: boolean;
}

const NOTIFICATION_STORAGE_KEY = 'stattrackr-notifications';
const POPUP_SHOWN_KEY = 'stattrackr-popup-shown';

const initialNotification: Notification = {
  id: 'dvp-fix-2025',
  title: 'Updates & What\'s Coming',
  content: `We've made some important improvements and have exciting features on the way!

✅ **What's Fixed:**
• Defense vs Position (DvP) stats are now 100% accurate and updated daily
• All defensive statistics are now sourced from reliable data providers

🚀 **Coming Soon:**
• **Player Comparison Tool**: See how players with similar playstyles, positions, and heights performed against specific teams
• **Advanced Journal Tracking**: Enhanced bet tracking with unit measurements and improved bug fixes

Thank you for your patience as we continue to improve StatTrackr!`,
  date: new Date().toISOString(),
  read: false,
};

export default function NotificationSystem({ isDark }: { isDark: boolean }) {
  const [showPopup, setShowPopup] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Load notifications and check if popup should be shown
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if popup has been shown
    const popupShown = localStorage.getItem(POPUP_SHOWN_KEY);
    if (!popupShown) {
      setShowPopup(true);
    }

    // Load notifications from localStorage
    const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setNotifications(parsed);
        setUnreadCount(parsed.filter((n: Notification) => !n.read).length);
      } catch (e) {
        console.error('Failed to parse notifications:', e);
      }
    } else {
      // Initialize with the initial notification
      setNotifications([initialNotification]);
      setUnreadCount(1);
    }
  }, []);

  // Save notifications to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(notifications));
    setUnreadCount(notifications.filter(n => !n.read).length);
  }, [notifications]);

  const handleClosePopup = () => {
    setShowPopup(false);
    localStorage.setItem(POPUP_SHOWN_KEY, 'true');
    
    // Add notification to list if not already there
    setNotifications(prev => {
      const exists = prev.find(n => n.id === initialNotification.id);
      if (!exists) {
        return [initialNotification, ...prev];
      }
      return prev;
    });
  };

  const handleNotificationClick = (id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleClearAll = () => {
    setNotifications([]);
    if (typeof window !== 'undefined') {
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify([]));
    }
    setUnreadCount(0);
  };

  return (
    <>
      {/* Notification Bell Icon */}
      <div className="relative">
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className={`relative p-2 rounded-lg transition-colors ${
            isDark
              ? 'hover:bg-gray-700 text-gray-300'
              : 'hover:bg-gray-100 text-gray-700'
          }`}
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Notifications Dropdown */}
        {showNotifications && (
          <>
            <div
              className="fixed inset-0 z-[200]"
              onClick={() => setShowNotifications(false)}
            />
            <div
              className={`absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto rounded-lg shadow-xl z-[201] ${
                isDark
                  ? 'bg-slate-800 border border-gray-700'
                  : 'bg-white border border-gray-200'
              }`}
            >
              <div className={`p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    Notifications
                  </h3>
                  <div className="flex items-center gap-3">
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className={`text-xs ${isDark ? 'text-purple-400' : 'text-purple-600'} hover:underline`}
                      >
                        Mark all read
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button
                        onClick={handleClearAll}
                        className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'} hover:underline`}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-2">
                {notifications.length === 0 ? (
                  <div className={`p-4 text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    No notifications
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification.id)}
                      className={`p-3 rounded-lg mb-2 cursor-pointer transition-colors ${
                        !notification.read
                          ? isDark
                            ? 'bg-slate-700 hover:bg-slate-600'
                            : 'bg-purple-50 hover:bg-purple-100'
                          : isDark
                          ? 'hover:bg-slate-700'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {notification.title}
                          </div>
                          <div className={`text-xs whitespace-pre-line ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                            {notification.content}
                          </div>
                          <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {new Date(notification.date).toLocaleDateString()}
                          </div>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0 mt-1" />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Initial Popup Modal */}
      {showPopup && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[300]"
            onClick={handleClosePopup}
          />
          <div
            className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-lg rounded-lg shadow-2xl z-[301] ${
              isDark
                ? 'bg-slate-800 border border-gray-700'
                : 'bg-white border border-gray-200'
            }`}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {initialNotification.title}
                </h2>
                <button
                  onClick={handleClosePopup}
                  className={`p-1 rounded-lg transition-colors ${
                    isDark
                      ? 'hover:bg-gray-700 text-gray-300'
                      : 'hover:bg-gray-100 text-gray-500'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div
                className={`text-sm whitespace-pre-line mb-4 ${
                  isDark ? 'text-gray-300' : 'text-gray-600'
                }`}
              >
                {initialNotification.content}
              </div>
              <button
                onClick={handleClosePopup}
                className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${
                  isDark
                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                    : 'bg-purple-600 hover:bg-purple-700 text-white'
                }`}
              >
                Got it!
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

