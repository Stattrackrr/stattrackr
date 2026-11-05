import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    absolute: 'Betting Tools | StatTrackr',
  },
};

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#050d1a] text-white">{children}</div>;
}
