import { NextResponse } from 'next/server';

type AdminUser = { email?: string | null };

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Could not check that email.' }, { status: 500 });
    }

    const res = await fetch(
      `${baseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        cache: 'no-store',
      }
    );
    const json = (await res.json().catch(() => ({}))) as { users?: AdminUser[]; msg?: string };
    if (!res.ok) {
      return NextResponse.json(
        { error: json.msg || 'Could not check that email.' },
        { status: 500 }
      );
    }

    const exists = (json.users || []).some((user) => String(user.email || '').toLowerCase() === email);
    return NextResponse.json({ exists });
  } catch {
    return NextResponse.json({ error: 'Could not check that email.' }, { status: 500 });
  }
}
