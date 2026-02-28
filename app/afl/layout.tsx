import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AFL',
  description: 'AFL player stats, game logs, and props analysis.',
};

export default function AFLLayout({ children }: { children: React.ReactNode }) {
  return children;
}
