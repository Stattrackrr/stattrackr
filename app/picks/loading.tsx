import { AiPicksFeedSkeleton } from '@/components/chat/AiPicksFeedSkeleton';

/**
 * Instant route shell when navigating to /picks.
 */
export default function PicksLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#050d1a]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1550px] flex-col px-3 pt-4 lg:pl-[calc(340px+2px)]">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:rounded-3xl lg:border lg:border-gray-200 lg:bg-white lg:shadow-sm dark:lg:border-gray-700 dark:lg:bg-[#0f1a2b]">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Picks</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Picks from Stattrackr AI, posted, tracked and graded automatically.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <AiPicksFeedSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
