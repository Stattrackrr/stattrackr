import { redirect } from 'next/navigation';
import { JOURNAL_ENABLED } from '@/lib/nbaConstants';

export default function JournalLayout({ children }: { children: React.ReactNode }) {
  if (!JOURNAL_ENABLED) redirect('/props');
  return children;
}
