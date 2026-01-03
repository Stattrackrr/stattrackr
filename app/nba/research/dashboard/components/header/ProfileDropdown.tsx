'use client';

interface ProfileDropdownProps {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onSubscription: () => void;
  onLogout: () => void;
  onClose: () => void;
}

export function ProfileDropdown({ dropdownRef, onSubscription, onLogout, onClose }: ProfileDropdownProps) {
  return (
    <div ref={dropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
      <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => {
            onClose();
            onSubscription();
          }}
          className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Subscription
        </button>
        <div className="border-t border-gray-200 dark:border-gray-700"></div>
        <button
          onClick={() => {
            onClose();
            onLogout();
          }}
          className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

