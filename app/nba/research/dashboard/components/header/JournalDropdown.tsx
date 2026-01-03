'use client';

import { useRouter } from 'next/navigation';

interface JournalDropdownProps {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function JournalDropdown({ dropdownRef, onClose }: JournalDropdownProps) {
  const router = useRouter();

  return (
    <div ref={dropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
      <div className="bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => {
            onClose();
            router.push('/journal');
          }}
          className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          View Journal
        </button>
      </div>
    </div>
  );
}

