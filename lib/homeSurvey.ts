import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const DATA_ADMIN_EMAIL = 'admin@stattrackr.co';

const SPORT_IDS = ['nba', 'nbl', 'afl', 'atp', 'wta'] as const;
const STAT_IDS = ['opponent', 'advanced', 'form', 'ai'] as const;
const BETTING_IDS = ['daily', 'few', 'weekly', 'monthly'] as const;
const RESEARCH_IDS = ['most', 'sometimes', 'never'] as const;
const GOAL_IDS = ['sites', 'find', 'start'] as const;
const PLAN_IDS = ['pro', 'free'] as const;
const CYCLE_IDS = ['monthly', 'semiannual', 'annual'] as const;

const SPORT_LABEL: Record<string, string> = {
  nba: 'NBA',
  nbl: 'NBL',
  afl: 'AFL',
  atp: 'ATP',
  wta: 'WTA',
};

const STAT_LABEL: Record<string, string> = {
  opponent: 'In-depth opponent breakdowns',
  advanced: 'Advanced player statistics',
  form: 'Player form',
  ai: 'AI models',
};

const BETTING_LABEL: Record<string, string> = {
  daily: 'Every day',
  few: 'Every few days',
  weekly: 'Once a week',
  monthly: 'Monthly',
};

const RESEARCH_LABEL: Record<string, string> = {
  most: 'Most of the time',
  sometimes: 'Sometimes',
  never: 'Never',
};

const GOAL_LABEL: Record<string, string> = {
  sites: 'Switching between too many sites',
  find: 'Finding the stats that matter',
  start: 'Knowing where to start',
};

const PLAN_LABEL: Record<string, string> = {
  pro: 'Pro',
  free: 'Free',
};

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  semiannual: '6 months',
  annual: 'Annual',
};

export const SURVEY_STEPS = [
  'started',
  'q1',
  'q2',
  'q3',
  'q4',
  'q5',
  'email_prompt',
  'email',
  'offer',
  'pro',
  'free',
] as const;

export type SurveyStep = (typeof SURVEY_STEPS)[number];

const STEP_RANK: Record<SurveyStep, number> = {
  started: 0,
  q1: 1,
  q2: 2,
  q3: 3,
  q4: 4,
  q5: 5,
  email_prompt: 6,
  email: 7,
  offer: 8,
  pro: 9,
  free: 9,
};

export type HomeSurveyRow = {
  id: string;
  visitor_id: string | null;
  email: string | null;
  sports: string[];
  betting: string | null;
  stats: string[];
  research: string | null;
  goal: string | null;
  plan_choice: string | null;
  billing_cycle: string | null;
  last_step: string | null;
  exited_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HomeSurveyInput = {
  email: string;
  sports: string[];
  betting: string | null;
  stats: string[];
  research: string | null;
  goal: string | null;
};

export type SurveyProgress = {
  visitorId: string;
  step: SurveyStep;
  sports: string[];
  betting: string | null;
  stats: string[];
  research: string | null;
  goal: string | null;
  email: string | null;
  exited: boolean;
};

export function isDataAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === DATA_ADMIN_EMAIL;
}

function pickIds(value: unknown, allowed: readonly string[], max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const picked = value.filter((item): item is string => typeof item === 'string' && allowed.includes(item));
  if (picked.length !== value.length || picked.length > max) return null;
  return [...new Set(picked)];
}

function pickOne(value: unknown, allowed: readonly string[]): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !allowed.includes(value)) return null;
  return value;
}

function isSurveyStep(value: string): value is SurveyStep {
  return (SURVEY_STEPS as readonly string[]).includes(value);
}

export function stepRank(step: string | null | undefined): number {
  if (step && isSurveyStep(step)) return STEP_RANK[step];
  return 0;
}

export function parseSurveyProgress(body: unknown): SurveyProgress | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const visitorId = typeof record.visitorId === 'string' ? record.visitorId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) return null;
  const step = typeof record.step === 'string' ? record.step : '';
  if (!isSurveyStep(step) || step === 'pro' || step === 'free') return null;
  const sports = pickIds(record.sports ?? [], SPORT_IDS, SPORT_IDS.length);
  const stats = pickIds(record.stats ?? [], STAT_IDS, STAT_IDS.length);
  if (!sports || !stats) return null;
  const betting = pickOne(record.betting, BETTING_IDS);
  const research = pickOne(record.research, RESEARCH_IDS);
  const goal = pickOne(record.goal, GOAL_IDS);
  if (record.betting != null && record.betting !== '' && !betting) return null;
  if (record.research != null && record.research !== '' && !research) return null;
  if (record.goal != null && record.goal !== '' && !goal) return null;
  const rawEmail = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : null;
  if (step === 'email' && !email) return null;
  return {
    visitorId,
    step,
    sports,
    betting,
    stats,
    research,
    goal,
    email,
    exited: record.exited === true,
  };
}

export function parseHomeSurveyInput(body: unknown): HomeSurveyInput | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return null;
  const sports = pickIds(record.sports, SPORT_IDS, SPORT_IDS.length);
  const stats = pickIds(record.stats, STAT_IDS, STAT_IDS.length);
  if (!sports || !stats) return null;
  const betting = pickOne(record.betting, BETTING_IDS);
  const research = pickOne(record.research, RESEARCH_IDS);
  const goal = pickOne(record.goal, GOAL_IDS);
  if (record.betting != null && record.betting !== '' && !betting) return null;
  if (record.research != null && record.research !== '' && !research) return null;
  if (record.goal != null && record.goal !== '' && !goal) return null;
  return { email, sports, betting, stats, research, goal };
}

export function parseSurveyChoice(body: unknown): { id: string; planChoice: 'pro' | 'free'; billingCycle: string | null } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const planChoice = pickOne(record.planChoice, PLAN_IDS);
  if (planChoice !== 'pro' && planChoice !== 'free') return null;
  const billingCycle = planChoice === 'pro' ? pickOne(record.billingCycle, CYCLE_IDS) : null;
  if (planChoice === 'pro' && record.billingCycle != null && record.billingCycle !== '' && !billingCycle) return null;
  return { id, planChoice, billingCycle };
}

export function labelList(ids: string[] | null | undefined, labels: Record<string, string>, allLabel: string, allCount: number): string {
  const picked = (ids ?? []).filter((id) => labels[id]);
  if (picked.length === 0) return '—';
  if (picked.length >= allCount) return allLabel;
  return picked.map((id) => labels[id]).join(', ');
}

export function sportText(ids: string[] | null | undefined): string {
  return labelList(ids, SPORT_LABEL, 'All sports', SPORT_IDS.length);
}

export function statText(ids: string[] | null | undefined): string {
  return labelList(ids, STAT_LABEL, 'All', STAT_IDS.length);
}

export function bettingText(id: string | null | undefined): string {
  return (id && BETTING_LABEL[id]) || '—';
}

export function researchText(id: string | null | undefined): string {
  return (id && RESEARCH_LABEL[id]) || '—';
}

export function goalText(id: string | null | undefined): string {
  return (id && GOAL_LABEL[id]) || '—';
}

export function planText(choice: string | null | undefined, cycle: string | null | undefined): string {
  if (!choice || !PLAN_LABEL[choice]) return 'Not chosen';
  if (choice === 'pro' && cycle && CYCLE_LABEL[cycle]) return `Pro · ${CYCLE_LABEL[cycle]}`;
  return PLAN_LABEL[choice];
}

export function surveyStatus(row: {
  email: string | null;
  plan_choice: string | null;
  last_step: string | null;
  exited_at: string | null;
}): string {
  if (row.plan_choice === 'pro') return 'Chose Pro';
  if (row.plan_choice === 'free') return 'Chose free';
  const left = Boolean(row.exited_at);
  if (row.last_step === 'offer') return left ? 'Saw the plan, then left' : 'Saw the plan';
  if (row.email) return left ? 'Entered email, then left' : 'Entered email';
  if (!left) return 'Still on the page';
  switch (row.last_step) {
    case 'started':
      return 'Opened the survey, then left';
    case 'q1':
      return 'Answered sports, then left';
    case 'q2':
      return 'Answered how often they bet, then left';
    case 'q3':
      return 'Answered stats, then left';
    case 'q4':
      return 'Answered research, then left';
    case 'q5':
    case 'email_prompt':
      return 'Reached the email box, then left';
    case 'offer':
      return 'Saw the plan, then left';
    default:
      return 'Left before email';
  }
}

export function formatSurveyTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function saveSurveyProgress(input: SurveyProgress): Promise<{ id: string } | { error: string }> {
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('home_survey_responses')
    .select('id, last_step')
    .eq('visitor_id', input.visitorId)
    .maybeSingle();

  if (lookupError) return { error: lookupError.message };

  const currentStep = typeof existing?.last_step === 'string' ? existing.last_step : 'started';
  const lastStep = stepRank(currentStep) > stepRank(input.step) ? currentStep : input.step;
  const patch: Record<string, unknown> = {
    sports: input.sports,
    betting: input.betting,
    stats: input.stats,
    research: input.research,
    goal: input.goal,
    last_step: lastStep,
    exited_at: input.exited ? now : null,
    updated_at: now,
  };
  if (input.email) patch.email = input.email;

  if (existing?.id) {
    const { error } = await supabaseAdmin.from('home_survey_responses').update(patch).eq('id', existing.id);
    if (error) return { error: error.message };
    return { id: existing.id as string };
  }

  const { data, error } = await supabaseAdmin
    .from('home_survey_responses')
    .insert({
      visitor_id: input.visitorId,
      email: input.email,
      ...patch,
    })
    .select('id')
    .single();

  if (error?.code === '23505') {
    const { data: raced } = await supabaseAdmin
      .from('home_survey_responses')
      .select('id')
      .eq('visitor_id', input.visitorId)
      .maybeSingle();
    if (raced?.id) {
      const { error: updateError } = await supabaseAdmin.from('home_survey_responses').update(patch).eq('id', raced.id);
      if (updateError) return { error: updateError.message };
      return { id: raced.id as string };
    }
  }

  if (error || !data?.id) return { error: error?.message || 'Could not save the survey.' };
  return { id: data.id as string };
}

export async function updateHomeSurveyChoice(
  id: string,
  planChoice: 'pro' | 'free',
  billingCycle: string | null
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabaseAdmin
    .from('home_survey_responses')
    .update({
      plan_choice: planChoice,
      billing_cycle: billingCycle,
      last_step: planChoice,
      exited_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return { error: error.message };
  return { ok: true };
}

export async function listHomeSurveys(): Promise<{ rows: HomeSurveyRow[] } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('home_survey_responses')
    .select('id, visitor_id, email, sports, betting, stats, research, goal, plan_choice, billing_cycle, last_step, exited_at, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) return { error: error.message };
  return { rows: (data ?? []) as HomeSurveyRow[] };
}
