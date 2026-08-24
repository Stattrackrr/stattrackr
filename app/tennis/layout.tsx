import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tennis',
  description: 'ATP and WTA player stats, match logs, and props analysis.',
};

export default function TennisLayout({ children }: { children: React.ReactNode }) {
  return children;
}
