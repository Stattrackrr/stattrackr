import { ThemeProvider } from '@/contexts/ThemeContext';
import PicksPageClient from './PicksPageClient';

export default function PicksPage() {
  return (
    <ThemeProvider>
      <PicksPageClient />
    </ThemeProvider>
  );
}
