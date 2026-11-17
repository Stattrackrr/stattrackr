import { ToolsBoardSkeleton } from './ToolsSkeletons';

/**
 * Instant route shell when navigating to /tools (before the client page hydrates).
 */
export default function ToolsLoading() {
  return (
    <div className="min-h-screen bg-[#050d1a] text-white">
      <div className="px-2 pt-4 lg:px-1 lg:pl-[calc(340px+2px)]">
        <div className="mx-auto w-full max-w-[1550px]">
          <ToolsBoardSkeleton isDark />
        </div>
      </div>
    </div>
  );
}
