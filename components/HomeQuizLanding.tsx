'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Image from 'next/image';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  DollarSign,
  LayoutGrid,
  LineChart,
  Medal,
  Megaphone,
  MessageCircle,
  Trophy,
  X,
} from 'lucide-react';
import { NBA_PUBLIC_ENABLED } from '@/lib/nbaConstants';

type Answers = {
  sports?: string[];
  betting?: string;
  stats?: string[];
  research?: string;
  goal?: string;
};

type Step = {
  key: keyof Answers;
  question: string;
  options: { id: string; label: string }[];
};

const SPORT_IDS = ['nba', 'nbl', 'afl', 'atp', 'wta'] as const;

const SPORT_LABEL: Record<string, string> = {
  nba: 'NBA',
  nbl: 'NBL',
  afl: 'AFL',
  atp: 'ATP',
  wta: 'WTA',
};

const VISITOR_KEY = 'stattrackr_survey_visitor';
type ProgressStep = 'started' | 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'email_prompt' | 'email' | 'offer';
const PROGRESS_RANK: Record<ProgressStep, number> = {
  started: 0,
  q1: 1,
  q2: 2,
  q3: 3,
  q4: 4,
  q5: 5,
  email_prompt: 6,
  email: 7,
  offer: 8,
};

function surveyVisitorId(): string {
  const existing = sessionStorage.getItem(VISITOR_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(VISITOR_KEY, id);
  return id;
}

function sportPhrase(sports?: string[]) {
  const ordered = SPORT_IDS.filter((id) => sports?.includes(id));
  if (ordered.length === 1) return SPORT_LABEL[ordered[0]];
  if (ordered.length === 2) return `${SPORT_LABEL[ordered[0]]} and ${SPORT_LABEL[ordered[1]]}`;
  return 'multi-sport';
}

const STEPS: Step[] = [
  {
    key: 'sports',
    question: 'Which sports are you researching?',
    options: [
      { id: 'nba', label: 'NBA' },
      { id: 'nbl', label: 'NBL' },
      { id: 'afl', label: 'AFL' },
      { id: 'atp', label: 'ATP' },
      { id: 'wta', label: 'WTA' },
      { id: 'all', label: 'All sports' },
    ],
  },
  {
    key: 'betting',
    question: 'How often do you place a bet?',
    options: [
      { id: 'daily', label: 'Every day' },
      { id: 'few', label: 'Every few days' },
      { id: 'weekly', label: 'Once a week' },
      { id: 'monthly', label: 'Monthly' },
    ],
  },
  {
    key: 'stats',
    question: 'What stats are you looking for?',
    options: [
      { id: 'opponent', label: 'In-depth opponent breakdowns' },
      { id: 'advanced', label: 'Advanced player statistics' },
      { id: 'form', label: 'Player form' },
      { id: 'ai', label: 'AI models' },
      { id: 'all', label: 'All' },
    ],
  },
  {
    key: 'research',
    question: 'When you place a bet, how often do you do research?',
    options: [
      { id: 'most', label: 'Most of the time' },
      { id: 'sometimes', label: 'Sometimes' },
      { id: 'never', label: 'Never' },
    ],
  },
  {
    key: 'goal',
    question: "What's the hardest part of researching a bet?",
    options: [
      { id: 'sites', label: 'Switching between too many sites' },
      { id: 'find', label: 'Finding the stats that matter' },
      { id: 'start', label: 'Knowing where to start' },
    ],
  },
];

const STAT_IDS = ['opponent', 'advanced', 'form', 'ai'] as const;

function planReason(answers: Answers): string {
  const ordered = SPORT_IDS.filter((id) => answers.sports?.includes(id));
  const sportBit =
    ordered.length === 1
      ? SPORT_LABEL[ordered[0]]
      : ordered.length === 2
        ? `${SPORT_LABEL[ordered[0]]} and ${SPORT_LABEL[ordered[1]]}`
        : 'every sport';
  const statNames: Record<string, string> = {
    opponent: 'in-depth opponent breakdowns',
    advanced: 'advanced player statistics',
    form: 'player form',
    ai: 'the AI models',
  };
  const picked = STAT_IDS.filter((id) => answers.stats?.includes(id));
  const statBit =
    picked.length === 0 || picked.length === STAT_IDS.length ? 'the full set of stats' : statNames[picked[0]] || 'those stats';
  const why: Record<string, string> = {
    sites: `You want ${statBit} for ${sportBit}, without jumping between sites.`,
    find: `You want ${statBit} for ${sportBit}, and those numbers are hard to find on their own.`,
    start: `You want ${statBit} for ${sportBit}, and a clear place to start.`,
  };
  return why[answers.goal || ''] || `You want ${statBit} for ${sportBit}.`;
}

const BOOKS: { name: string; color: string; logo: string }[] = [
  { name: 'Sportsbet', color: '#0b61ff', logo: 'sportsbet' },
  { name: 'PointsBet', color: '#EE3124', logo: 'pointsbet' },
  { name: 'Bet365', color: '#1C6E38', logo: 'bet365' },
  { name: 'Ladbrokes', color: '#006B3F', logo: 'ladbrokes' },
  { name: 'TAB', color: '#00843D', logo: 'tab' },
  { name: 'Neds', color: '#E31837', logo: 'neds' },
  { name: 'Betr', color: '#9333ea', logo: 'betr' },
  { name: 'Betfair', color: '#FFB81C', logo: 'betfair' },
  { name: 'Unibet', color: '#43B649', logo: 'unibet' },
  { name: 'DraftKings', color: '#53D337', logo: 'draftkings' },
  { name: 'FanDuel', color: '#0070EB', logo: 'fanduel' },
  { name: 'BetMGM', color: '#C5A572', logo: 'betmgm' },
  { name: 'Fanatics', color: '#011E41', logo: 'fanatics' },
  { name: 'Caesars', color: '#002855', logo: 'caesars' },
  { name: 'Dabble', color: '#7C3AED', logo: 'dabble' },
];

const PLAN_FEATURES = [
  'All statistics - NBA',
  'All statistics - AFL',
  'All statistics - NBL',
  'All statistics - ATP',
  'All statistics - WTA',
  'AFL premium prediction model',
  'Admin picks',
  'All device compatibility',
  'Priority support',
];

const COMPARE_ROWS: { icon: typeof Medal; feature: string; pro: string; free: string; freeOk?: boolean }[] = [
  { icon: Medal, feature: 'Sports', pro: 'NBA, AFL, NBL, ATP, WTA', free: 'NBA, AFL, NBL, ATP, WTA', freeOk: true },
  { icon: LayoutGrid, feature: 'Props board', pro: 'Full board', free: '1 prop per sport' },
  { icon: LineChart, feature: 'Advanced stats for every sport', pro: 'Included', free: 'Locked' },
  { icon: Trophy, feature: 'AFL prediction model', pro: 'Included', free: 'Locked' },
  { icon: Megaphone, feature: 'Admin picks', pro: 'Included', free: 'Locked' },
  { icon: MessageCircle, feature: 'Chat', pro: 'Included', free: 'Locked' },
  { icon: DollarSign, feature: 'Price', pro: 'From $20/month', free: 'Free', freeOk: true },
];

type BillingCycle = 'monthly' | 'semiannual' | 'annual';

function PageContinue({
  onStartPro,
  onSignIn,
}: {
  onStartPro: (cycle?: BillingCycle) => void;
  onSignIn: () => void;
}) {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div className="bg-[#050d1a] text-white">
      <section className="border-y border-white/10 bg-[#0a1929]">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-7 sm:grid-cols-3 sm:gap-10 sm:px-10">
          {[
            ['5+ sports', 'NBA, AFL, NBL, ATP, and WTA.'],
            ['Player props', 'Ranked by the matchup.'],
            ['Statistics', 'The most in-depth in Australia.'],
          ].map(([title, body]) => (
            <div key={title} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" aria-hidden />
              <div>
                <h2 className="text-base font-medium tracking-tight">{title}</h2>
                <p className="mt-0.5 text-sm text-gray-400">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-6 py-14 sm:px-10 lg:py-16">
          <h2 className="max-w-md text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
            The same stats, on any screen.
          </h2>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-gray-400">
            Phone, tablet, or desk.
          </p>
          <div className="mt-10 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
            <div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Bookmakers covered</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {BOOKS.map((book) => (
                  <div
                    key={book.name}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent p-3"
                  >
                    <div
                      className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/95"
                      style={{ boxShadow: `0 0 0 1px ${book.color}33` }}
                    >
                      <Image
                        src={`/images/bookmakers/${book.logo}.png?v=20260802b`}
                        alt={`${book.name} logo`}
                        width={28}
                        height={28}
                        className="h-7 w-7 object-contain"
                        unoptimized
                      />
                    </div>
                    <span className="text-center text-[10px] font-semibold leading-tight text-gray-300">{book.name}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-600">Lines ranked by value across every major book.</p>
            </div>
            <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl lg:max-w-[320px]">
              <Image
                src="/images/hero-devices.webp"
                alt="StatTrackr on a laptop, tablet, and phone"
                width={640}
                height={640}
                sizes="320px"
                className="h-auto w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 bg-[#050d1a] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-4xl font-bold sm:text-5xl">Free vs Pro</h2>
            <p className="mx-auto max-w-2xl text-xl text-gray-400">
              What each plan includes that the other does not.
            </p>
          </div>
          <div className="space-y-3 md:hidden">
            {COMPARE_ROWS.map((row) => (
              <div key={row.feature} className="overflow-hidden rounded-2xl border border-gray-800 bg-[#071422]">
                <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3 text-sm text-gray-200">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-white/[0.03] text-gray-400">
                    <row.icon className="h-4 w-4" />
                  </span>
                  {row.feature}
                </div>
                <div className="grid grid-cols-2 text-sm">
                  <div className="bg-[#0c1c33] px-3 py-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-purple-300">StatTrackr</p>
                    <p className="flex items-start gap-1.5 font-medium leading-snug text-emerald-400">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" />
                      {row.pro}
                    </p>
                  </div>
                  <div className="px-3 py-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Free</p>
                    <p className={`flex items-start gap-1.5 font-medium leading-snug ${row.freeOk ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.freeOk ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />}
                      {row.free}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <div className="overflow-hidden rounded-2xl border border-gray-800 bg-[#071422]">
              <div className="grid grid-cols-[1.15fr_1fr_1fr] text-sm">
                <div className="px-5 py-5 text-xs font-semibold uppercase tracking-widest text-gray-500">Feature</div>
                <div className="flex items-center justify-center gap-2 border-x border-purple-500/30 bg-[#0c1c33] px-4 py-4">
                  <Image src="/images/stattrackr-logo-512.webp" alt="" width={22} height={22} className="h-5 w-5" />
                  <span className="font-semibold text-white">StatTrackr</span>
                  <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Best</span>
                </div>
                <div className="px-5 py-5 text-center text-sm font-medium text-gray-400">Free</div>
                {COMPARE_ROWS.map((row) => (
                  <Fragment key={row.feature}>
                    <div className="flex items-center gap-3 border-t border-gray-800 px-5 py-4 text-gray-200">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-white/[0.03] text-gray-400">
                        <row.icon className="h-4 w-4" />
                      </span>
                      {row.feature}
                    </div>
                    <div className="flex items-center justify-center gap-2 border-x border-t border-purple-500/30 bg-[#0c1c33] px-4 py-4 font-medium text-emerald-400">
                      <Check className="h-4 w-4" />
                      {row.pro}
                    </div>
                    <div className={`flex items-center justify-center gap-2 border-t border-gray-800 px-4 py-4 font-medium ${row.freeOk ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.freeOk ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      {row.free}
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 bg-[#050d1a] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold sm:text-5xl">Competitive pricing</h2>
            <p className="mx-auto max-w-2xl text-lg text-gray-400">Pick the billing cycle that suits you.</p>
          </div>
          <div className="mb-8 flex justify-center md:hidden">
            <div className="flex gap-1 rounded-xl border border-gray-800 bg-white/[0.05] p-1">
              {(['monthly', 'semiannual', 'annual'] as const).map((cycle) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                    billingCycle === cycle ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {cycle === 'monthly' ? 'Monthly' : cycle === 'semiannual' ? '6 Months' : 'Annual'}
                </button>
              ))}
            </div>
          </div>
          <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
            <div className={`rounded-xl border-2 bg-[#050d1a] p-8 ${billingCycle === 'monthly' ? 'border-purple-600 shadow-2xl shadow-purple-600/20' : 'border-gray-800'} ${billingCycle !== 'monthly' ? 'hidden md:block' : ''}`}>
              <div className="mb-6">
                <h3 className="mb-2 text-2xl font-bold">Pro</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">$20.00</span>
                  <span className="text-sm font-medium text-gray-400">AUD</span>
                  <span className="text-gray-400">/month</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">Billed monthly</p>
              </div>
              <ul className="mb-8 space-y-3">
                {PLAN_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-400" />
                    <span className="text-sm text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => onStartPro('monthly')} className="w-full rounded-lg bg-purple-600 py-3 font-semibold text-white transition-all hover:bg-purple-700">
                Subscribe
              </button>
            </div>
            <div className={`rounded-xl border-2 bg-[#050d1a] p-8 ${billingCycle === 'semiannual' ? 'border-purple-600 shadow-2xl shadow-purple-600/20' : 'border-gray-800'} ${billingCycle !== 'semiannual' ? 'hidden md:block' : ''}`}>
              <div className="mb-6">
                <h3 className="mb-2 text-2xl font-bold">Pro</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">$100.00</span>
                  <span className="text-sm font-medium text-gray-400">AUD</span>
                  <span className="text-gray-400">/6 months</span>
                </div>
                <p className="mt-2 text-xs text-emerald-400">Save 17%</p>
              </div>
              <ul className="mb-8 space-y-3">
                {PLAN_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-400" />
                    <span className="text-sm text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => onStartPro('semiannual')} className="w-full rounded-lg bg-purple-600 py-3 font-semibold text-white transition-all hover:bg-purple-700">
                Subscribe
              </button>
            </div>
            <div className={`rounded-xl border-2 bg-[#050d1a] p-8 ${billingCycle === 'annual' ? 'border-purple-600 shadow-2xl shadow-purple-600/20' : 'border-gray-800'} ${billingCycle !== 'annual' ? 'hidden md:block' : ''}`}>
              <div className="mb-6">
                <h3 className="mb-2 text-2xl font-bold">Pro</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">$180.00</span>
                  <span className="text-sm font-medium text-gray-400">AUD</span>
                  <span className="text-gray-400">/year</span>
                </div>
                <p className="mt-2 text-xs text-emerald-400">Save 25%</p>
              </div>
              <ul className="mb-8 space-y-3">
                {PLAN_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-400" />
                    <span className="text-sm text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => onStartPro('annual')} className="w-full rounded-lg bg-purple-600 py-3 font-semibold text-white transition-all hover:bg-purple-700">
                Subscribe
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 bg-[#050d1a] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Questions, answered</h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'How has the AFL prediction model performed?', a: 'Profitable every week of the AFL season. The model has consistently identified value across rounds, giving subscribers an edge week after week.' },
              { q: 'How have the admin picks performed?', a: '40+ units made across the season. Our team\'s hand-selected picks have delivered strong, consistent returns for subscribers.' },
              { q: 'Can I cancel anytime?', a: 'Yes. You can cancel your subscription at any time. There are no cancellation fees and no unnecessary hurdles.' },
              { q: 'Is mobile supported?', a: 'Yes. StatTrackr works across phone, tablet, and desktop. The full feature set and data are available on mobile, so you can research on the go.' },
              { q: 'How do I contact support?', a: <>Email us at <a href="mailto:Support@Stattrackr.co" className="text-purple-400 underline hover:text-purple-300">Support@Stattrackr.co</a>. We typically respond within 24 hours.</> },
              { q: 'What sports are available?', a: 'We cover NBA, AFL, NBL, ATP, and WTA, with full stats, props, and research tools. We\'re always adding more and will announce new sports when they\'re ready.' },
              { q: 'Are the top-ranked props the best picks?', a: 'No. The ranking is based on line value and odds sourced from bookmakers, not our recommendations. We provide the data and tools; how you interpret them is entirely up to you. Use the filters and dashboard to draw your own conclusions.' },
            ].map((faq, i) => (
              <div
                key={faq.q}
                onClick={() => setOpenFAQ(openFAQ === i ? null : i)}
                className="cursor-pointer rounded-xl border border-gray-800 bg-white/[0.03] p-4 transition-colors hover:border-purple-500/50"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-semibold text-white">{faq.q}</h3>
                  <svg
                    className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform ${openFAQ === i ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {openFAQ === i && (
                  <p className="mt-3 text-sm leading-relaxed text-gray-400">{faq.a}</p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <p className="mb-6 text-lg font-medium text-gray-400">Sports coverage</p>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-5 sm:gap-x-8">
              <Image src="/images/nba-logo.png" alt="NBA" width={80} height={160} className="h-16 w-7 object-cover object-center mix-blend-screen sm:h-24 sm:w-11" />
              <Image src="/images/afl-logo.png" alt="AFL" width={160} height={160} className="h-24 w-auto object-contain sm:h-36" />
              <Image src="/images/nbl-logo.png" alt="NBL" width={160} height={160} className="h-14 w-auto object-contain mix-blend-screen sm:h-20" />
              <span className="inline-flex h-10 w-24 items-center justify-center overflow-hidden sm:h-14 sm:w-32">
                <Image src="/images/atp-logo.webp" alt="ATP" width={200} height={80} className="h-[220%] w-auto max-w-none object-cover" />
              </span>
              <Image src="/images/wta-logo.png" alt="WTA" width={160} height={160} className="h-16 w-auto object-contain mix-blend-screen sm:h-24" />
            </div>
          </div>
          <p className="mt-10 text-center text-gray-400">
            <a href="mailto:Support@Stattrackr.co" className="text-purple-400 underline hover:text-purple-300">Support@Stattrackr.co</a>
          </p>
        </div>
      </section>

      <section className="relative overflow-hidden bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-20 text-center sm:px-6 lg:px-8">
        <div aria-hidden className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative mx-auto max-w-5xl">
          <h2 className="mb-4 text-3xl font-bold sm:text-5xl">Ready to get started?</h2>
          <p className="mx-auto mb-8 max-w-xl text-lg text-white/80">Subscribe to Pro. Cancel anytime.</p>
          <button type="button" onClick={() => onStartPro()} className="rounded-lg bg-white px-8 py-4 text-lg font-semibold text-purple-600 shadow-lg transition-all hover:scale-[1.02] hover:bg-gray-100">
            Subscribe
          </button>
        </div>
      </section>

      <footer className="border-t border-gray-800 bg-[#050d1a] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <Image src="/images/stattrackr-logo-512.webp" alt="StatTrackr" width={32} height={32} className="h-8 w-8" />
                <span className="text-xl font-bold">StatTrackr</span>
              </div>
              <p className="text-sm text-gray-400">Multi-sport research and analytics platform for serious analysts and researchers.</p>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><button type="button" onClick={() => scrollTo('features')} className="transition-colors hover:text-white">Features</button></li>
                <li><button type="button" onClick={() => scrollTo('pricing')} className="transition-colors hover:text-white">Pricing</button></li>
                <li><button type="button" onClick={() => scrollTo('faq')} className="transition-colors hover:text-white">FAQ</button></li>
                <li><a href="/props?sport=all" className="transition-colors hover:text-white">Player Props</a></li>
                <li>
                  {NBA_PUBLIC_ENABLED ? (
                    <a href="/nba/research/dashboard" className="transition-colors hover:text-white">NBA Dashboard</a>
                  ) : (
                    <span className="text-gray-500">NBA Dashboard (off-season)</span>
                  )}
                </li>
                <li><a href="/afl" className="transition-colors hover:text-white">AFL Research</a></li>
                <li><a href="/nbl" className="transition-colors hover:text-white">NBL Research</a></li>
                <li><a href="/tennis" className="transition-colors hover:text-white">ATP & WTA</a></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="/terms" className="transition-colors hover:text-white">Terms</a></li>
                <li><a href="/privacy" className="transition-colors hover:text-white">Privacy</a></li>
                <li><button type="button" onClick={onSignIn} className="transition-colors hover:text-white">Sign In</button></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">Legal</h4>
              <p className="text-sm text-gray-400">StatTrackr is a research and analytics platform. We do not facilitate betting or gambling activities.</p>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
            <p>© {new Date().getFullYear()} StatTrackr. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Shell({
  children,
  cover,
}: {
  children: ReactNode;
  cover?: boolean;
}) {
  return (
    <div
      className={
        cover
          ? 'fixed inset-0 z-[80] flex min-h-dvh flex-col overflow-y-auto bg-[#050d1a] text-white'
          : 'flex min-h-dvh shrink-0 snap-start flex-col bg-[#050d1a] text-white lg:h-dvh lg:overflow-hidden'
      }
    >
      {children}
    </div>
  );
}

export default function HomeQuizLanding({
  onSignIn,
  onStartPro,
  onContinueFree,
  onPhaseChange,
}: {
  onSignIn: () => void;
  onStartPro: (cycle?: BillingCycle, email?: string) => void;
  onContinueFree: (email?: string) => void;
  onPhaseChange?: (phase: 'intro' | 'survey' | 'email' | 'plan' | 'offer') => void;
}) {
  const [phase, setPhase] = useState<'intro' | 'survey' | 'email' | 'plan' | 'offer'>('intro');
  const [step, setStep] = useState(0);
  const [stepMotion, setStepMotion] = useState<'forward' | 'back'>('forward');
  const [leaving, setLeaving] = useState<'forward' | 'back' | null>(null);
  const advancingRef = useRef(false);
  const motionTimerRef = useRef<number | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const responseIdRef = useRef<string | null>(null);
  const pendingChoiceRef = useRef<{ choice: 'pro' | 'free'; cycle?: BillingCycle } | null>(null);
  const furthestStepRef = useRef<ProgressStep>('started');
  const answersRef = useRef(answers);
  const emailRef = useRef(email);
  answersRef.current = answers;
  emailRef.current = email;

  const saveProgressRef = useRef<
    (step: ProgressStep, nextAnswers: Answers, exited: boolean, emailValue?: string | null) => void
  >(() => undefined);
  saveProgressRef.current = (step, nextAnswers, exited, emailValue) => {
    if (PROGRESS_RANK[step] >= PROGRESS_RANK[furthestStepRef.current]) furthestStepRef.current = step;
    const emailToSend = (emailValue ?? '').trim();
    void fetch('/api/home-survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId: surveyVisitorId(),
        step: furthestStepRef.current,
        sports: nextAnswers.sports ?? [],
        betting: nextAnswers.betting ?? null,
        stats: nextAnswers.stats ?? [],
        research: nextAnswers.research ?? null,
        goal: nextAnswers.goal ?? null,
        email: emailToSend || null,
        exited,
      }),
      keepalive: true,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { id?: string } | null) => {
        if (!body?.id) return;
        responseIdRef.current = body.id;
        const pending = pendingChoiceRef.current;
        if (!pending) return;
        pendingChoiceRef.current = null;
        sendSurveyChoice(body.id, pending.choice, pending.cycle);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  useEffect(() => {
    return () => {
      if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current);
    };
  }, []);

  const queueMotion = (run: () => void, delay: number) => {
    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current);
    motionTimerRef.current = window.setTimeout(() => {
      motionTimerRef.current = null;
      run();
    }, delay);
  };

  useEffect(() => {
    if (phase !== 'plan') return;
    const timer = window.setTimeout(() => setPhase('offer'), 1500);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'offer') return;
    saveProgressRef.current('offer', answersRef.current, false, emailRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase === 'intro') return;
    const markLeft = (exited: boolean) => {
      saveProgressRef.current(furthestStepRef.current, answersRef.current, exited, emailRef.current);
    };
    const onVisibility = () => markLeft(document.visibilityState === 'hidden');
    const onPageHide = () => markLeft(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [phase]);

  const choose = (id: string) => {
    if (advancingRef.current) return;
    const current = STEPS[step];
    const nextAnswers: Answers =
      current.key === 'sports'
        ? { ...answers, sports: id === 'all' ? [...SPORT_IDS] : [id] }
        : current.key === 'stats'
          ? { ...answers, stats: id === 'all' ? [...STAT_IDS] : [id] }
          : { ...answers, [current.key]: id };
    setAnswers(nextAnswers);
    answersRef.current = nextAnswers;
    const questionStep = (['q1', 'q2', 'q3', 'q4', 'q5'] as const)[step] ?? 'q5';
    if (step < STEPS.length - 1) {
      saveProgressRef.current(questionStep, nextAnswers, false, emailRef.current);
      advancingRef.current = true;
      const nextStep = step + 1;
      setLeaving('forward');
      queueMotion(() => {
        setLeaving(null);
        setStepMotion('forward');
        setStep(nextStep);
        advancingRef.current = false;
      }, 220);
      return;
    }
    saveProgressRef.current('email_prompt', nextAnswers, false, emailRef.current);
    advancingRef.current = true;
    setLeaving('forward');
    queueMotion(() => {
      setLeaving(null);
      advancingRef.current = false;
      setPhase('email');
    }, 220);
  };

  const optionSelected = (id: string) => {
    const current = STEPS[step];
    if (current.key === 'sports' || current.key === 'stats') {
      const selected = answers[current.key] ?? [];
      const ids = current.key === 'sports' ? SPORT_IDS : STAT_IDS;
      if (id === 'all') return ids.every((item) => selected.includes(item));
      return selected.length === 1 && selected[0] === id;
    }
    return answers[current.key] === id;
  };

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const next = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmail(next);
    emailRef.current = next;
    setEmailError('');
    saveProgressRef.current('email', answers, false, next);
    setPhase('plan');
  };

  const sendSurveyChoice = (id: string, choice: 'pro' | 'free', cycle?: BillingCycle) => {
    void fetch('/api/home-survey', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        planChoice: choice,
        billingCycle: cycle ?? null,
      }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const recordChoice = (choice: 'pro' | 'free', cycle?: BillingCycle) => {
    const id = responseIdRef.current;
    if (!id) {
      pendingChoiceRef.current = { choice, cycle };
      return;
    }
    sendSurveyChoice(id, choice, cycle);
  };

  if (phase === 'intro') {
    return (
      <>
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-[#050d1a]/95 px-5 backdrop-blur-sm sm:px-8">
          <div className="flex items-center gap-2">
            <Image
              src="/images/stattrackr-logo-512.webp"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7"
              priority
            />
            <span className="text-lg font-semibold tracking-tight">StatTrackr</span>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="text-sm font-medium text-gray-400 hover:text-white"
          >
            Sign in
          </button>
        </header>
        <section className="relative grid min-h-[calc(100dvh-4rem)] bg-[#050d1a] lg:grid-cols-2">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-32 -top-40 h-[40rem] w-[40rem] rounded-full bg-purple-600/20 blur-3xl" />
            <div className="absolute -right-40 top-0 h-[28rem] w-[28rem] rounded-full bg-blue-600/10 blur-3xl" />
          </div>
          <div className="relative order-2 flex flex-col justify-center px-6 py-12 sm:px-14 lg:order-1 lg:px-16 xl:px-24">
            <h1 className="max-w-md text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Australia&apos;s most advanced
              <span className="block bg-gradient-to-r from-purple-400 via-blue-400 to-purple-600 bg-clip-text text-transparent">
                sports research.
              </span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-gray-300">
              Every stat you need, all in one spot.
            </p>
            <button
              type="button"
              onClick={() => {
                setPhase('survey');
                saveProgressRef.current('started', answersRef.current, false, null);
              }}
              className="mt-8 h-12 w-full max-w-sm rounded-full bg-purple-600 text-base font-medium text-white shadow-[0_10px_30px_-12px_rgba(147,51,234,0.9)] transition-colors hover:bg-purple-700"
            >
              Continue
            </button>
          </div>
          <div className="order-1 flex min-h-[42vh] p-4 lg:order-2 lg:min-h-0 lg:p-8 lg:pl-4">
            <div className="relative min-h-[36vh] w-full flex-1 overflow-hidden rounded-[1.75rem] lg:min-h-[calc(100dvh-8rem)]">
              <Image
                src="/images/hero-app-in-use.webp"
                alt="Someone checking player stats on their phone"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 45vw"
                className="object-cover object-[center_30%]"
              />
            </div>
          </div>
        </section>
        <PageContinue onStartPro={onStartPro} onSignIn={onSignIn} />
      </>
    );
  }

  if (phase === 'email') {
    return (
      <Shell cover>
        <div className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-10 sm:px-6">
          <form
            className="quiz-card-in w-full overflow-hidden rounded-2xl border border-white/15 bg-[#0a1929] shadow-[0_24px_80px_-32px_rgba(0,0,0,0.85)]"
            onSubmit={submitEmail}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 sm:px-6">
              <button
                type="button"
                onClick={() => setPhase('survey')}
                className="inline-flex items-center gap-1 text-sm font-medium text-gray-400 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <div className="flex items-center gap-2">
                <Image
                  src="/images/stattrackr-logo-512.webp"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7"
                />
                <span className="text-sm font-semibold tracking-tight">StatTrackr</span>
              </div>
            </div>
            <div className="px-5 py-7 sm:px-6 sm:py-8">
              <h2 className="text-[1.65rem] font-semibold leading-tight tracking-tight">
                See which plan suits you
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">Enter your email to continue.</p>
              <label htmlFor="quiz-email" className="mt-7 block text-xs font-medium uppercase tracking-[0.14em] text-gray-500">
                Email
              </label>
              <input
                id="quiz-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (emailError) setEmailError('');
                }}
                placeholder="you@email.com"
                className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-[#071422] px-3.5 text-base text-white outline-none placeholder:text-gray-500 focus:border-purple-500"
              />
              {emailError ? <p className="mt-2 text-sm text-red-400">{emailError}</p> : null}
              <button
                type="submit"
                className="mt-5 h-12 w-full rounded-lg bg-purple-600 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      </Shell>
    );
  }

  if (phase === 'plan') {
    const sport = sportPhrase(answers.sports);
    return (
      <Shell cover>
        <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div aria-hidden className="quiz-build-glow pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/30 blur-3xl" />
          <div className="relative">
            <div className="quiz-build-ring h-16 w-16 rounded-full border-2 border-white/10 border-t-purple-400 shadow-[0_0_28px_rgba(168,85,247,0.45)]" />
          </div>
          <div className="quiz-card-in relative">
            <p className="mt-8 text-sm font-medium uppercase tracking-[0.18em] text-purple-300">Building your board</p>
            <h2 className="mt-4 max-w-lg text-3xl font-medium tracking-tight sm:text-4xl">
              Your {sport} board
            </h2>
            <p className="mt-3 text-gray-400">Using the answers you just gave.</p>
          </div>
          <div className="relative mt-8 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
            <div className="quiz-build-fill h-full w-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-400" />
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'offer') {
    return (
      <Shell cover>
        <div className="relative mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-10 sm:px-6">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/25 blur-3xl" />
          <div className="quiz-card-in relative w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0a1929] shadow-[0_30px_80px_-36px_rgba(0,0,0,0.9)]">
            <div className="flex items-center justify-between px-6 pt-6 sm:px-8">
              <div className="flex items-center gap-2.5">
                <Image src="/images/stattrackr-logo-512.webp" alt="" width={32} height={32} className="h-8 w-8" />
                <span className="text-[15px] font-semibold tracking-tight">StatTrackr</span>
              </div>
              <span className="rounded-full border border-purple-400/25 bg-purple-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-purple-200">
                Your plan
              </span>
            </div>
            <div className="px-6 pb-7 pt-8 sm:px-8 sm:pb-8">
              <p className="text-center text-[15px] text-gray-400">Based on your selections, your plan is:</p>
              <h2 className="pro-plan-glow mt-1 text-center text-5xl font-semibold tracking-tight text-purple-400">
                Pro
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-7 text-gray-300">{planReason(answers)}</p>
              <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#071422]">
                <div className="grid grid-cols-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
                  <div className="bg-purple-500/10 px-3 py-2.5 text-purple-200">Pro</div>
                  <div className="px-3 py-2.5 text-gray-500">Free</div>
                </div>
                {COMPARE_ROWS.map((row) => (
                  <div key={row.feature} className="border-t border-white/10">
                    <div className="flex items-center gap-2 px-3 pt-2.5 text-[13px] text-gray-200">
                      <row.icon className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden />
                      {row.feature}
                    </div>
                    <div className="mt-1 grid grid-cols-2 pb-2.5 text-[13px] font-medium leading-snug">
                      <div className="flex items-start gap-1.5 bg-purple-500/10 px-3 py-1.5 text-emerald-400">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>{row.pro}</span>
                      </div>
                      <div
                        className={`flex items-start gap-1.5 px-3 py-1.5 ${
                          row.freeOk ? 'text-emerald-400' : 'text-rose-300'
                        }`}
                      >
                        {row.freeOk ? (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        ) : (
                          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        <span>{row.free}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8 border-t border-white/10 pt-6">
                <div className="flex items-end justify-between gap-4">
                  <p className="text-3xl font-semibold tracking-tight">
                    $20
                    <span className="ml-1.5 text-base font-medium text-gray-400">AUD</span>
                  </p>
                  <p className="pb-1 text-sm text-gray-500">per month</p>
                </div>
                <p className="mt-1 text-sm text-gray-500">Cancel anytime.</p>
                <button
                  type="button"
                  onClick={() => {
                    recordChoice('pro', 'monthly');
                    onStartPro(undefined, email);
                  }}
                  className="mt-5 h-12 w-full rounded-full bg-purple-600 text-[15px] font-semibold text-white shadow-[0_12px_32px_-14px_rgba(147,51,234,0.95)] transition-colors hover:bg-purple-500"
                >
                  Start Pro
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  recordChoice('free');
                  onContinueFree(email);
                }}
                className="mt-4 w-full text-center text-sm font-medium text-gray-300 underline-offset-4 hover:text-white hover:underline"
              >
                Continue free
              </button>
              <p className="mt-2 text-center text-sm text-gray-500">1 prop per sport, limited data</p>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  const current = STEPS[step];

  return (
    <Shell cover>
      <div className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-10 sm:px-6">
        <div className="quiz-card-in w-full overflow-hidden rounded-2xl border border-white/25 bg-[#0a1929] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_28px_80px_-28px_rgba(0,0,0,0.85)]">
          <div className="px-6 py-7 sm:px-8 sm:py-8">
            <div className="mb-8">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (advancingRef.current) return;
                    if (step === 0) {
                      setPhase('intro');
                      return;
                    }
                    advancingRef.current = true;
                    setLeaving('back');
                    queueMotion(() => {
                      setLeaving(null);
                      setStepMotion('back');
                      setStep((current) => current - 1);
                      advancingRef.current = false;
                    }, 220);
                  }}
                  className="text-sm font-medium text-gray-400 hover:text-white"
                >
                  Back
                </button>
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">
                  Question {step + 1} of {STEPS.length}
                </span>
              </div>
              <div
                className="mt-4 flex gap-1.5"
                role="progressbar"
                aria-valuenow={step + 1}
                aria-valuemin={1}
                aria-valuemax={STEPS.length}
                aria-label={`Question ${step + 1} of ${STEPS.length}`}
              >
                {STEPS.map((item, index) => (
                  <div key={item.key} className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        index < step
                          ? 'w-full bg-purple-500'
                          : index === step
                            ? 'quiz-progress-live w-full shadow-[0_0_16px_rgba(168,85,247,0.55)]'
                            : 'w-0'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div
              key={`${step}-${stepMotion}`}
              className={
                leaving === 'forward'
                  ? 'quiz-step-leave'
                  : leaving === 'back'
                    ? 'quiz-step-leave-back'
                    : stepMotion === 'back'
                      ? 'quiz-step-back'
                      : 'quiz-step-forward'
              }
            >
            <h2 className="text-3xl font-semibold tracking-tight sm:text-[2.15rem] sm:leading-tight">{current.question}</h2>
            <div className="mt-8 space-y-3">
              {current.options.map((option, index) => {
                const selected = optionSelected(option.id);
                const showLetter = current.key !== 'sports' && current.key !== 'stats';
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => choose(option.id)}
                    style={{ animationDelay: `${70 + index * 55}ms` }}
                    className={`quiz-option-in flex w-full items-center gap-4 rounded-xl border px-4 py-4 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 active:scale-[0.985] ${
                      selected
                        ? 'scale-[1.015] border-purple-400 bg-purple-500/20 text-white shadow-[0_0_24px_-8px_rgba(168,85,247,0.9)]'
                        : 'border-white/10 bg-[#071422] text-gray-100 hover:border-purple-400/60 hover:bg-[#0c1c33]'
                    }`}
                  >
                    {showLetter && (
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                          selected ? 'bg-purple-600 text-white' : 'border border-white/10 text-gray-400'
                        }`}
                      >
                        {String.fromCharCode(65 + index)}
                      </span>
                    )}
                    <span className="text-base font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
