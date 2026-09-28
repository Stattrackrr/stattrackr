import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Survey data',
  robots: { index: false, follow: false },
};

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return children;
}
