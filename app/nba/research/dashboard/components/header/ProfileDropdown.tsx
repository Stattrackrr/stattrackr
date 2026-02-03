'use client';

interface ProfileDropdownProps {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onProfileClick?: () => void;
  showViewTrackingButton?: boolean;
  onViewTrackingClick?: () => void;
  onSubscription: () => void;
  onLogout: () => void;
  onClose: () => void;
}

export function ProfileDropdown({
  dropdownRef,
  onProfileClick,
  showViewTrackingButton,
  onViewTrackingClick,
  onSubscription,
  onLogout,
  onClose,
}: ProfileDropdownProps) {
  return (
    <div ref={dropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
      <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden min-w-[180px]">
        {onProfileClick && (
          <>
            <button
              onClick={() => {
                onClose();
                onProfileClick();
              }}
              className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Profile
            </button>
            <div className="border-t border-gray-200 dark:border-gray-700" />
          </>
        )}
        {showViewTrackingButton && onViewTrackingClick && (
          <>
            <button
              onClick={() => {
                onClose();
                onViewTrackingClick();
              }}
              className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View Tracking
            </button>
            <div className="border-t border-gray-200 dark:border-gray-700" />
          </>
        )}
        <button
          onClick={() => {
            onClose();
            onSubscription();
          }}
          className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
        >
          <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          Subscription
        </button>
        <button
          onClick={() => {
            onClose();
            onLogout();
          }}
          className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700 transition-colors"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1z" />
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}

