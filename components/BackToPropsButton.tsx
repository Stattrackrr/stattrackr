'use client';

import { useRouter } from 'next/navigation';
import { consumePropsReturnPath } from '@/lib/propsPageSessionCache';

/** Same "Back to Player Props" link as the sport dashboards; returns to the props view the user came from. */
export function BackToPropsButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        router.prefetch('/props?sport=all');
        router.push(consumePropsReturnPath('combined'));
      }}
      className={`flex items-center gap-1.5 text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 ${className}`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      <span>Back to Player Props</span>
    </button>
  );
}
