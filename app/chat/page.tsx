import { redirect } from 'next/navigation';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CHAT_ENABLED } from '@/lib/nbaConstants';
import ChatPageClient from './ChatPageClient';

export default function ChatPage() {
  if (!CHAT_ENABLED) redirect('/props');
  return (
    <ThemeProvider>
      <ChatPageClient />
    </ThemeProvider>
  );
}
