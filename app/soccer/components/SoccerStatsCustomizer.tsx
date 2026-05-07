'use client';

type SoccerStatsCustomizerOption = {
  key: string;
  label: string;
};

type SoccerStatsCustomizerProps = {
  isDark: boolean;
  open: boolean;
  options: SoccerStatsCustomizerOption[];
  selectedKeys: string[];
  onToggleOpen: () => void;
  onToggleKey: (key: string) => void;
  onSelectAll?: () => void;
  onReset?: () => void;
  resetLabel?: string;
};

export function SoccerStatsCustomizer({
  isDark,
  open,
  options,
  selectedKeys,
  onToggleOpen,
  onToggleKey,
  onSelectAll,
  onReset,
  resetLabel = 'Reset',
}: SoccerStatsCustomizerProps) {
  return (
    <>
      <div className="pt-1">
        <button
          type="button"
          onClick={onToggleOpen}
          className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
            isDark
              ? 'border-gray-700 bg-[#0f172a] text-white hover:bg-[#162033]'
              : 'border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100'
          }`}
        >
          {open ? 'Hide stat customizer' : 'Customize stats'}
        </button>
      </div>
      {open ? (
        <div className={`mt-1 rounded-xl border p-2 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Choose stats to show
            </div>
            <div className="flex items-center gap-1">
              {onSelectAll ? (
                <button
                  type="button"
                  onClick={onSelectAll}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
                    isDark
                      ? 'bg-gray-800 text-gray-200 hover:bg-gray-700'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Show all
                </button>
              ) : null}
              {onReset ? (
                <button
                  type="button"
                  onClick={onReset}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
                    isDark
                      ? 'bg-gray-800 text-gray-200 hover:bg-gray-700'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {resetLabel}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => {
              const isSelected = selectedKeys.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onToggleKey(option.key)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    isSelected
                      ? 'border-purple-500 bg-purple-600 text-white'
                      : isDark
                        ? 'border-gray-700 bg-[#111827] text-gray-300 hover:bg-gray-800'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
