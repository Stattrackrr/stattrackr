import type { Metadata } from 'next';
import { CombinedPropsPrefetch } from './CombinedPropsPrefetch';

export const metadata: Metadata = {
  title: {
    absolute: 'Player Props | StatTrackr',
  },
};

export default function PropsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#050d1a] text-white">
      <CombinedPropsPrefetch />
      {children}
    </div>
  );
}
