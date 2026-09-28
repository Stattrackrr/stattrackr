'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '@/lib/supabaseClient';

const DATA_ADMIN_EMAIL = 'admin@stattrackr.co';

const SPORT_LABEL: Record<string, string> = {
  nba: 'NBA',
  nbl: 'NBL',
  afl: 'AFL',
  atp: 'ATP',
  wta: 'WTA',
};
const STAT_LABEL: Record<string, string> = {
  opponent: 'Opponent breakdowns',
  advanced: 'Advanced stats',
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
  sites: 'Too many sites',
  find: 'Stats are hard to find',
  start: 'No clear place to start',
};
const PLAN_LABEL: Record<string, string> = { pro: 'Pro', free: 'Free' };
const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  semiannual: '6 months',
  annual: 'Annual',
};

const SPORT_IDS = ['nba', 'nbl', 'afl', 'atp', 'wta'] as const;
const STAT_IDS = ['opponent', 'advanced', 'form', 'ai'] as const;
const BETTING_IDS = ['daily', 'few', 'weekly', 'monthly'] as const;
const RESEARCH_IDS = ['most', 'sometimes', 'never'] as const;
const GOAL_IDS = ['sites', 'find', 'start'] as const;

const SERIES = ['#c084fc', '#818cf8', '#38bdf8', '#34d399', '#fb7185', '#fbbf24'];

type SurveyRow = {
  id: string;
  email: string | null;
  sports: string[] | null;
  betting: string | null;
  stats: string[] | null;
  research: string | null;
  goal: string | null;
  plan_choice: string | null;
  billing_cycle: string | null;
  last_step: string | null;
  exited_at: string | null;
  created_at: string;
};

type Point = { label: string; count: number };

const STOP_ORDER: { status: string; short: string }[] = [
  { status: 'Still on the page', short: 'Still here' },
  { status: 'Opened the survey, then left', short: 'Left at open' },
  { status: 'Answered sports, then left', short: 'Left after sports' },
  { status: 'Answered how often they bet, then left', short: 'Left after betting' },
  { status: 'Answered stats, then left', short: 'Left after stats' },
  { status: 'Answered research, then left', short: 'Left after research' },
  { status: 'Reached the email box, then left', short: 'Left at email box' },
  { status: 'Entered email', short: 'Entered email' },
  { status: 'Entered email, then left', short: 'Left after email' },
  { status: 'Saw the plan', short: 'Saw the plan' },
  { status: 'Saw the plan, then left', short: 'Left at the plan' },
  { status: 'Chose Pro', short: 'Chose Pro' },
  { status: 'Chose free', short: 'Chose free' },
];

function surveyStatus(row: SurveyRow): string {
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
    default:
      return 'Left before email';
  }
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function labelList(ids: string[] | null | undefined, labels: Record<string, string>, allLabel: string, allCount: number): string {
  const picked = (ids ?? []).filter((id) => labels[id]);
  if (picked.length === 0) return '—';
  if (picked.length >= allCount) return allLabel;
  return picked.map((id) => labels[id]).join(', ');
}

function sportText(ids: string[] | null | undefined): string {
  return labelList(ids, SPORT_LABEL, 'All sports', SPORT_IDS.length);
}

function statText(ids: string[] | null | undefined): string {
  return labelList(ids, STAT_LABEL, 'All', STAT_IDS.length);
}

function named(id: string | null | undefined, labels: Record<string, string>): string {
  return (id && labels[id]) || '—';
}

function planText(choice: string | null | undefined, cycle: string | null | undefined): string {
  if (!choice || !PLAN_LABEL[choice]) return 'Not chosen';
  if (choice === 'pro' && cycle && CYCLE_LABEL[cycle]) return `Pro · ${CYCLE_LABEL[cycle]}`;
  return PLAN_LABEL[choice];
}

function formatSurveyTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sydneyDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function shortDay(isoDay: string): string {
  const date = new Date(`${isoDay}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function orderedCounts(ids: readonly string[], labels: Record<string, string>, countOf: (id: string) => number): Point[] {
  return ids.map((id) => ({ label: labels[id] ?? id, count: countOf(id) }));
}

function stopColor(status: string): string {
  if (status === 'Chose Pro') return '#c084fc';
  if (status === 'Chose free') return '#34d399';
  if (status === 'Still on the page' || status === 'Entered email' || status === 'Saw the plan') return '#38bdf8';
  return '#fb7185';
}

function statusTone(status: string): string {
  if (status === 'Chose Pro') return 'bg-purple-500/15 text-purple-200 ring-purple-400/30';
  if (status === 'Chose free') return 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30';
  if (status === 'Still on the page' || status === 'Entered email' || status === 'Saw the plan') {
    return 'bg-sky-500/15 text-sky-200 ring-sky-400/30';
  }
  return 'bg-rose-500/15 text-rose-200 ring-rose-400/30';
}

function Panel({
  title,
  caption,
  children,
  className = '',
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-[#0a1929] p-4 sm:p-5 ${className}`}>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">{title}</h2>
      {caption ? <p className="mt-1 text-sm text-gray-400">{caption}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DarkTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number | string; name?: string; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#050d1a] px-3 py-2 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.8)]">
      {label ? <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">{label}</p> : null}
      {payload.map((item) => (
        <p key={`${item.name}-${item.value}`} className="mt-1 text-sm font-medium text-white">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: item.color || '#c084fc' }} />
          {item.name ? <span className="text-gray-400">{item.name} </span> : null}
          {item.value}
        </p>
      ))}
    </div>
  );
}

function FunnelChart({ steps }: { steps: { label: string; count: number }[] }) {
  const max = Math.max(steps[0]?.count ?? 0, 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((step, index) => {
        const previous = index === 0 ? step.count : steps[index - 1].count;
        const kept = previous > 0 ? Math.round((step.count / previous) * 100) : 0;
        const width = step.count === 0 ? 0 : Math.max((step.count / max) * 100, 6);
        return (
          <li key={step.label} className="grid items-center gap-2 sm:grid-cols-[6.75rem_1fr_6.25rem] sm:gap-3">
            <p className="text-xs text-gray-300">{step.label}</p>
            <div className="h-7 rounded-md bg-white/[0.04]">
              <div
                className="flex h-full items-center rounded-md bg-gradient-to-r from-purple-700 to-fuchsia-400 px-2"
                style={{ width: `${width}%`, opacity: step.count === 0 ? 0.35 : 1 }}
              />
            </div>
            <p className="whitespace-nowrap text-right text-xs tabular-nums leading-4 text-gray-300">
              <span className="block">
                {step.count}
                <span className="text-gray-500"> · {pct(step.count, max)}%</span>
              </span>
              <span className="block text-[10px] text-gray-500">{index === 0 ? 'of everyone' : `${kept}% continued`}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Donut({ slices }: { slices: { label: string; count: number; fill: string }[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  if (total === 0) {
    return <p className="flex h-[220px] items-center justify-center text-sm text-gray-500">No responses yet.</p>;
  }
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[180px_1fr]">
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="count" nameKey="label" innerRadius={58} outerRadius={80} paddingAngle={3} stroke="none">
              {slices.map((slice) => (
                <Cell key={slice.label} fill={slice.fill} />
              ))}
            </Pie>
            <Tooltip content={<DarkTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-2">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-gray-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.fill }} />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="tabular-nums text-gray-400">
              {slice.count}
              <span className="text-gray-500"> · {pct(slice.count, total)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerBars({ points, color }: { points: Point[]; color: string }) {
  const hasAny = points.some((point) => point.count > 0);
  if (!hasAny) {
    return <p className="flex h-[180px] items-center justify-center text-sm text-gray-500">No answers yet.</p>;
  }
  return (
    <div style={{ height: Math.max(points.length * 44, 160) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} layout="vertical" margin={{ top: 0, right: 28, left: 8, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={176}
            tick={{ fill: '#d1d5db', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="count" name="People" fill={color} radius={[0, 6, 6, 0]} barSize={14}>
            <LabelList dataKey="count" position="right" fill="#9ca3af" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const FILTERS = ['All', 'Left before email', 'Entered email', 'Chose Pro', 'Chose free'] as const;

export default function DataPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SurveyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email?.trim().toLowerCase() ?? '';
      if (!session?.access_token || !email) {
        router.replace('/login?redirect=/data');
        return;
      }
      if (email !== DATA_ADMIN_EMAIL) {
        router.replace('/home');
        return;
      }
      const loadWithToken = (token: string) =>
        fetch('/api/home-survey', { headers: { Authorization: `Bearer ${token}` } });
      let response = await loadWithToken(session.access_token);
      if (response.status === 401 || response.status === 403) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed.session?.access_token) {
          response = await loadWithToken(refreshed.session.access_token);
        }
      }
      if (cancelled) return;
      if (response.status === 401 || response.status === 403) {
        router.replace('/login?redirect=/data');
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setLoadError(body?.error || 'Could not load surveys.');
        setRows([]);
        return;
      }
      const body = (await response.json().catch(() => null)) as { rows?: SurveyRow[] } | null;
      if (cancelled) return;
      setRows(body?.rows ?? []);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const downloadCsv = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    setDownloading(true);
    try {
      const response = await fetch('/api/home-survey?format=csv', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'stattrackr-surveys.csv';
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const listed = rows ?? [];
  const proCount = listed.filter((row) => row.plan_choice === 'pro').length;
  const freeCount = listed.filter((row) => row.plan_choice === 'free').length;
  const leftBeforeEmail = listed.filter((row) => !row.email && !row.plan_choice && Boolean(row.exited_at)).length;
  const answeredThenLeft = listed.filter((row) => {
    const status = surveyStatus(row);
    return status.startsWith('Answered') || status === 'Reached the email box, then left';
  }).length;
  const enteredEmail = listed.filter((row) => Boolean(row.email)).length;
  const sawPlan = listed.filter(
    (row) => row.last_step === 'offer' || row.last_step === 'pro' || row.last_step === 'free' || Boolean(row.plan_choice)
  ).length;
  const stillHere = listed.filter((row) => !row.email && !row.plan_choice && !row.exited_at).length;
  const reachedEmailNoPlan = Math.max(listed.length - proCount - freeCount - leftBeforeEmail - stillHere, 0);

  const funnel = [
    { label: 'Opened', count: listed.length },
    { label: 'Sports', count: listed.filter((row) => (row.sports?.length ?? 0) > 0).length },
    { label: 'Betting', count: listed.filter((row) => Boolean(row.betting)).length },
    { label: 'Stats', count: listed.filter((row) => (row.stats?.length ?? 0) > 0).length },
    { label: 'Research', count: listed.filter((row) => Boolean(row.research)).length },
    { label: 'Hardest part', count: listed.filter((row) => Boolean(row.goal)).length },
    { label: 'Email', count: enteredEmail },
    { label: 'Saw plan', count: sawPlan },
    { label: 'Chose plan', count: proCount + freeCount },
  ];

  const stops = STOP_ORDER.map((item) => ({
    ...item,
    count: listed.filter((row) => surveyStatus(row) === item.status).length,
  })).filter((item) => item.count > 0);

  const volume = useMemo(() => {
    const counts = new Map<string, { day: string; started: number; emails: number }>();
    for (const row of listed) {
      const day = sydneyDay(row.created_at);
      const current = counts.get(day) ?? { day, started: 0, emails: 0 };
      current.started += 1;
      if (row.email) current.emails += 1;
      counts.set(day, current);
    }
    const keys = [...counts.keys()].sort();
    if (keys.length === 0) return [];
    const points: { label: string; started: number; emails: number }[] = [];
    const pushDay = (key: string) => {
      const point = counts.get(key);
      points.push({ label: shortDay(key), started: point?.started ?? 0, emails: point?.emails ?? 0 });
    };
    const [startYear, startMonth, startDate] = keys[0].split('-').map(Number);
    const [endYear, endMonth, endDate] = keys[keys.length - 1].split('-').map(Number);
    const start = Date.UTC(startYear, startMonth - 1, startDate);
    const end = Date.UTC(endYear, endMonth - 1, endDate);
    const span = Math.round((end - start) / 86400000);
    if (span > 60) {
      for (const key of keys) pushDay(key);
      return points;
    }
    for (let cursor = start; cursor <= end; cursor += 86400000) {
      pushDay(new Date(cursor).toISOString().slice(0, 10));
    }
    return points;
  }, [listed]);

  const sports = orderedCounts(SPORT_IDS, SPORT_LABEL, (id) => listed.filter((row) => row.sports?.includes(id)).length);
  const betting = orderedCounts(BETTING_IDS, BETTING_LABEL, (id) => listed.filter((row) => row.betting === id).length);
  const stats = orderedCounts(STAT_IDS, STAT_LABEL, (id) => listed.filter((row) => row.stats?.includes(id)).length);
  const research = orderedCounts(RESEARCH_IDS, RESEARCH_LABEL, (id) => listed.filter((row) => row.research === id).length);
  const goals = orderedCounts(GOAL_IDS, GOAL_LABEL, (id) => listed.filter((row) => row.goal === id).length);
  const allSports = listed.filter((row) => SPORT_IDS.every((id) => row.sports?.includes(id))).length;

  const outcome = [
    { label: 'Chose Pro', count: proCount, fill: '#c084fc' },
    { label: 'Chose free', count: freeCount, fill: '#34d399' },
    { label: 'Left before email', count: leftBeforeEmail, fill: '#fb7185' },
    { label: 'Still in the survey', count: stillHere, fill: '#94a3b8' },
    { label: 'Email, no plan yet', count: reachedEmailNoPlan, fill: '#38bdf8' },
  ].filter((slice) => slice.count > 0);

  const needle = query.trim().toLowerCase();
  const visible = listed.filter((row) => {
    const status = surveyStatus(row);
    if (filter === 'Left before email' && !(!row.email && !row.plan_choice && row.exited_at)) return false;
    if (filter === 'Entered email' && !row.email) return false;
    if (filter === 'Chose Pro' && row.plan_choice !== 'pro') return false;
    if (filter === 'Chose free' && row.plan_choice !== 'free') return false;
    if (!needle) return true;
    return (row.email ?? '').toLowerCase().includes(needle) || status.toLowerCase().includes(needle);
  });

  const kpis = [
    { label: 'Started', value: String(listed.length), hint: 'Opened the survey' },
    { label: 'Email capture', value: `${pct(enteredEmail, listed.length)}%`, hint: `${enteredEmail} entered an email` },
    { label: 'Left before email', value: String(leftBeforeEmail), hint: `${answeredThenLeft} had already answered` },
    {
      label: 'Pro from emails',
      value: enteredEmail ? `${pct(proCount, enteredEmail)}%` : '—',
      hint: `${proCount} chose Pro · ${freeCount} chose free`,
    },
  ];

  return (
    <main className="min-h-dvh bg-[#050d1a] text-white">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300">StatTrackr research</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Survey data</h1>
            <p className="mt-2 max-w-xl text-sm text-gray-400">
              {listed.length === 0
                ? 'Drop-off, answers, and plan choice. Times are Sydney.'
                : `${pct(leftBeforeEmail, listed.length)}% leave before email.${
                    enteredEmail ? ` ${pct(proCount, enteredEmail)}% of emails choose Pro.` : ''
                  } Times are Sydney.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void downloadCsv()}
            disabled={downloading || rows === null}
            className="inline-flex h-10 items-center rounded-full bg-purple-600 px-4 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {downloading ? 'Downloading…' : 'Download CSV'}
          </button>
        </div>

        {rows === null ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-4">
            {kpis.map((item) => (
              <div key={item.label} className="h-24 animate-pulse rounded-2xl border border-white/10 bg-[#0a1929]" />
            ))}
          </div>
        ) : loadError ? (
          <p className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Could not load surveys. {loadError}{' '}
            {/does not exist|schema cache/i.test(loadError) ? (
              <>
                Run <span className="font-medium">migrations/create_home_survey_responses.sql</span> in Supabase again, then reload.
              </>
            ) : (
              'Reload the page.'
            )}
          </p>
        ) : (
          <>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-[#0a1929] px-4 py-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-500">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{item.value}</p>
                  <p className="mt-1 text-xs text-gray-500">{item.hint}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-5">
              <Panel
                className="xl:col-span-3"
                title="How far they got"
                caption="Each bar is people who reached that step. The small percent is how many continued from the step above."
              >
                <FunnelChart steps={funnel} />
              </Panel>
              <Panel className="xl:col-span-2" title="Where they ended" caption="Every person sits in one slice.">
                <Donut slices={outcome} />
              </Panel>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-5">
              <Panel
                className="xl:col-span-3"
                title="Where they stopped"
                caption={`${answeredThenLeft} ${answeredThenLeft === 1 ? 'person answered and left' : 'people answered and left'} before entering an email.`}
              >
                {stops.length === 0 ? (
                  <p className="flex h-[220px] items-center justify-center text-sm text-gray-500">No one has stopped yet.</p>
                ) : (
                  <div style={{ height: Math.max(stops.length * 36, 180) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stops} layout="vertical" margin={{ top: 0, right: 28, left: 8, bottom: 0 }}>
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="short"
                          width={128}
                          tick={{ fill: '#d1d5db', fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                        <Bar dataKey="count" name="People" radius={[0, 6, 6, 0]} barSize={12}>
                          {stops.map((item) => (
                            <Cell key={item.status} fill={stopColor(item.status)} />
                          ))}
                          <LabelList dataKey="count" position="right" fill="#9ca3af" fontSize={11} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
              <Panel className="xl:col-span-2" title="By day" caption="New surveys and emails. Sydney dates.">
                {volume.length === 0 ? (
                  <p className="flex h-[220px] items-center justify-center text-sm text-gray-500">No responses yet.</p>
                ) : (
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={volume} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="surveyStarted" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#c084fc" stopOpacity={0.45} />
                            <stop offset="100%" stopColor="#c084fc" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="surveyEmails" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                        <Tooltip content={<DarkTooltip />} />
                        <Area type="monotone" dataKey="started" name="Started" stroke="#c084fc" fill="url(#surveyStarted)" strokeWidth={2} />
                        <Area type="monotone" dataKey="emails" name="Emails" stroke="#38bdf8" fill="url(#surveyEmails)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Panel title="Sports" caption={allSports ? `${allSports} picked every sport, so they count in each bar.` : 'Each selected sport. All sports counts in every bar.'}>
                <AnswerBars points={sports} color={SERIES[0]} />
              </Panel>
              <Panel title="How often they bet">
                <AnswerBars points={betting} color={SERIES[1]} />
              </Panel>
              <Panel title="Stats they want" caption="All counts in every bar.">
                <AnswerBars points={stats} color={SERIES[2]} />
              </Panel>
              <Panel title="How often they research">
                <AnswerBars points={research} color={SERIES[3]} />
              </Panel>
              <Panel title="Hardest part of researching" className="lg:col-span-2">
                <AnswerBars points={goals} color={SERIES[4]} />
              </Panel>
            </div>

            <section className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#0a1929]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">Every response</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Showing {visible.length} of {listed.length}
                  </p>
                </div>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search email or status"
                  className="h-9 w-full rounded-full border border-white/10 bg-[#050d1a] px-4 text-sm text-white outline-none placeholder:text-gray-500 focus:border-purple-400/60 sm:w-64"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto px-4 py-3 sm:px-5">
                {FILTERS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                      filter === item ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="max-h-[32rem] overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#0a1929] text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    <tr>
                      {['Time', 'Status', 'Email', 'Sports', 'Betting', 'Stats', 'Research', 'Hardest part', 'Plan'].map((heading) => (
                        <th key={heading} className="whitespace-nowrap px-4 py-3 font-medium">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-gray-500">
                          {listed.length === 0 ? 'No survey responses yet.' : 'Nothing matches that filter.'}
                        </td>
                      </tr>
                    ) : (
                      visible.map((row) => {
                        const status = surveyStatus(row);
                        return (
                          <tr key={row.id} className="border-t border-white/10">
                            <td className="whitespace-nowrap px-4 py-3 text-gray-400">{formatSurveyTime(row.created_at)}</td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ring-1 ${statusTone(status)}`}>{status}</span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">{row.email || '—'}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-200">{sportText(row.sports)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{named(row.betting, BETTING_LABEL)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{statText(row.stats)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{named(row.research, RESEARCH_LABEL)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{named(row.goal, GOAL_LABEL)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-200">{planText(row.plan_choice, row.billing_cycle)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
