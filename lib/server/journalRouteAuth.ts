import { createClient } from '@/lib/supabase/server';

export async function getJournalRouteUser(req: Request) {
  const supabase = await createClient();
  let user: { id: string } | null = null;

  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const {
      data: { user: tokenUser },
      error: tokenError,
    } = await supabase.auth.getUser(token);
    if (!tokenError && tokenUser) {
      user = tokenUser;
    }
  }

  if (!user) {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (!sessionError && session?.user) {
      user = session.user;
    }
  }

  return user;
}
