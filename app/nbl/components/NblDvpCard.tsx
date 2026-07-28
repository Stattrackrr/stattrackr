'use client';

/** Empty DVP panel body — fills the fixed analysis tab height. */
export default function NblDvpCard({ isDark = false }: { isDark?: boolean }) {
  return (
    <div className={`flex-1 min-h-0 w-full ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
  );
}
