import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NBL',
  description: 'NBL player stats, game logs, and props analysis.',
};

export default function NBLLayout({ children }: { children: React.ReactNode }) {
  return children;
}
