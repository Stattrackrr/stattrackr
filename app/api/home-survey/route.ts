import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { RateLimiter, checkRateLimit } from '@/lib/rateLimit';
import {
  formatSurveyTime,
  goalText,
  heardText,
  isDataAdminEmail,
  listHomeSurveys,
  parseSurveyProgress,
  saveSurveyProgress,
  parseSurveyChoice,
  planText,
  researchText,
  bettingText,
  sportText,
  statText,
  surveyStatus,
  updateHomeSurveyChoice,
} from '@/lib/homeSurvey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const surveyWriteLimiter = new RateLimiter(120, 15);

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(request, surveyWriteLimiter);
  if (!limit.allowed && limit.response) return limit.response;

  const body = await request.json().catch(() => null);
  const input = parseSurveyProgress(body);
  if (!input) {
    return NextResponse.json({ error: 'Invalid survey.' }, { status: 400 });
  }

  const saved = await saveSurveyProgress(input);
  if ('error' in saved) {
    console.error('[home-survey] insert failed:', saved.error);
    return NextResponse.json({ error: 'Could not save the survey.' }, { status: 500 });
  }
  return NextResponse.json({ id: saved.id });
}

export async function PATCH(request: NextRequest) {
  const limit = checkRateLimit(request, surveyWriteLimiter);
  if (!limit.allowed && limit.response) return limit.response;

  const body = await request.json().catch(() => null);
  const choice = parseSurveyChoice(body);
  if (!choice) {
    return NextResponse.json({ error: 'Invalid choice.' }, { status: 400 });
  }

  const updated = await updateHomeSurveyChoice(choice.id, choice.planChoice, choice.billingCycle);
  if ('error' in updated) {
    console.error('[home-survey] update failed:', updated.error);
    return NextResponse.json({ error: 'Could not update the survey.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function requestEmail(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
    return user?.email ?? null;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function GET(request: NextRequest) {
  const email = await requestEmail(request);
  if (!isDataAdminEmail(email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const listed = await listHomeSurveys();
  if ('error' in listed) {
    console.error('[home-survey] list failed:', listed.error);
    return NextResponse.json({ error: listed.error }, { status: 500 });
  }

  if (request.nextUrl.searchParams.get('format') !== 'csv') {
    return NextResponse.json({ rows: listed.rows });
  }

  const header = ['Time', 'Status', 'Email', 'Sports', 'Betting', 'Stats', 'Research', 'Hardest part', 'Heard about us', 'Plan'];
  const lines = listed.rows.map((row) =>
    [
      formatSurveyTime(row.created_at),
      surveyStatus(row),
      row.email ?? '',
      sportText(row.sports),
      bettingText(row.betting),
      statText(row.stats),
      researchText(row.research),
      goalText(row.goal),
      heardText(row.heard),
      planText(row.plan_choice, row.billing_cycle),
    ]
      .map(csvCell)
      .join(',')
  );
  const csv = [header.map(csvCell).join(','), ...lines].join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="stattrackr-surveys.csv"',
    },
  });
}
