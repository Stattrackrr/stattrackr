import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createClient } from '@/lib/supabase/server';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { apiRateLimiter, checkRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SPORTS = ['Tennis', 'Soccer', 'MLB', 'Esports'] as const;
type AllowedSport = (typeof ALLOWED_SPORTS)[number];
const SURVEY_REDIS_KEY = 'props-next-sport-survey:votes';

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || '';
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const surveyRedis =
  upstashUrl && upstashToken
    ? new Redis({ url: upstashUrl, token: upstashToken })
    : null;

type SurveyVoteRecord = {
  userId: string;
  userEmail: string | null;
  selectedSport: AllowedSport;
  sourcePage: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

function isAllowedSport(value: unknown): value is AllowedSport {
  return typeof value === 'string' && ALLOWED_SPORTS.includes(value as AllowedSport);
}

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip');
}

async function saveVoteToRedis(vote: SurveyVoteRecord): Promise<boolean> {
  if (!surveyRedis) return false;
  try {
    await surveyRedis.hset(SURVEY_REDIS_KEY, {
      [vote.userId]: JSON.stringify(vote),
    });
    return true;
  } catch (error) {
    console.error('[PropsSportSurvey] Redis save failed:', error);
    return false;
  }
}

async function loadVotesFromRedis(): Promise<SurveyVoteRecord[] | null> {
  if (!surveyRedis) return null;
  try {
    const raw = await surveyRedis.hgetall<Record<string, string>>(SURVEY_REDIS_KEY);
    if (!raw || typeof raw !== 'object') {
      return [];
    }

    const votes: SurveyVoteRecord[] = [];
    for (const value of Object.values(raw)) {
      if (typeof value !== 'string') continue;
      try {
        const parsed = JSON.parse(value) as SurveyVoteRecord;
        if (parsed && isAllowedSport(parsed.selectedSport)) {
          votes.push(parsed);
        }
      } catch {
        // Ignore malformed entries
      }
    }

    votes.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return votes;
  } catch (error) {
    console.error('[PropsSportSurvey] Redis load failed:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(request, apiRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    let userId: string | null = null;
    let userEmail: string | null = null;

    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;

    if (bearerToken) {
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
      if (!authError && user) {
        userId = user.id;
        userEmail = user.email ?? null;
      }
    }

    if (!userId) {
      const supabase = await createClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = session.user.id;
      userEmail = session.user.email ?? null;
    }

    const body = await request.json();
    const selectedSport = body?.selectedSport;
    const sourcePage = typeof body?.sourcePage === 'string' ? body.sourcePage.slice(0, 50) : 'props';

    if (!isAllowedSport(selectedSport)) {
      return NextResponse.json({ error: 'Invalid sport selection' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const voteRecord: SurveyVoteRecord = {
      userId,
      userEmail,
      selectedSport,
      sourcePage: sourcePage || 'props',
      createdAt: timestamp,
      updatedAt: timestamp,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    };

    const redisSaved = await saveVoteToRedis(voteRecord);
    if (redisSaved) {
      return NextResponse.json({ success: true });
    }

    const { error } = await supabaseAdmin
      .from('props_next_sport_survey_votes')
      .upsert(
        {
          user_id: userId,
          user_email: userEmail,
          selected_sport: selectedSport,
          source_page: sourcePage || 'props',
          user_agent: voteRecord.userAgent,
          ip_address: voteRecord.ipAddress,
          updated_at: timestamp,
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('[PropsSportSurvey] Failed to store vote:', error);
      return NextResponse.json({ error: 'Failed to save vote' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PropsSportSurvey] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await authorizeAdminRequest(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    const rateResult = checkRateLimit(request, apiRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const redisVotes = await loadVotesFromRedis();
    if (redisVotes) {
      const totals = Object.fromEntries(ALLOWED_SPORTS.map((sport) => [sport, 0])) as Record<AllowedSport, number>;
      for (const row of redisVotes) {
        totals[row.selectedSport] += 1;
      }

      return NextResponse.json({
        success: true,
        totals,
        totalResponses: redisVotes.length,
        responses: redisVotes.map((row) => ({
          user_email: row.userEmail,
          selected_sport: row.selectedSport,
          source_page: row.sourcePage,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        })),
        storage: 'redis',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('props_next_sport_survey_votes')
      .select('user_email, selected_sport, source_page, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[PropsSportSurvey] Failed to fetch results:', error);
      return NextResponse.json({ error: 'Failed to load survey results' }, { status: 500 });
    }

    const totals = Object.fromEntries(ALLOWED_SPORTS.map((sport) => [sport, 0])) as Record<AllowedSport, number>;
    for (const row of data ?? []) {
      if (isAllowedSport(row.selected_sport)) {
        totals[row.selected_sport] += 1;
      }
    }

    return NextResponse.json({
      success: true,
      totals,
      totalResponses: (data ?? []).length,
      responses: data ?? [],
      storage: 'supabase',
    });
  } catch (error) {
    console.error('[PropsSportSurvey] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
