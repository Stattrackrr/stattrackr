import { ThemeProvider } from '@/contexts/ThemeContext';
import ChatPageClient from './ChatPageClient';

export default function ChatPage() {
  return (
    <ThemeProvider>
      <ChatPageClient />
    </ThemeProvider>
  );
}
