-- Logged-out homepage survey responses, including people who leave before the email.
-- Written and read only through the service role. The public anon key cannot see this table.
-- Safe to run again if the first version of this table already exists.

create table if not exists public.home_survey_responses (
  id uuid primary key default gen_random_uuid(),
  visitor_id text,
  email text,
  sports text[] not null default '{}',
  betting text,
  stats text[] not null default '{}',
  research text,
  goal text,
  plan_choice text check (plan_choice in ('pro', 'free')),
  billing_cycle text check (billing_cycle in ('monthly', 'semiannual', 'annual')),
  last_step text not null default 'started',
  exited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.home_survey_responses add column if not exists heard text;
alter table public.home_survey_responses add column if not exists visitor_id text;
alter table public.home_survey_responses add column if not exists last_step text not null default 'started';
alter table public.home_survey_responses add column if not exists exited_at timestamptz;
alter table public.home_survey_responses alter column email drop not null;

alter table public.home_survey_responses enable row level security;

revoke all on public.home_survey_responses from anon;
revoke all on public.home_survey_responses from authenticated;

create index if not exists home_survey_responses_created_at_idx
  on public.home_survey_responses (created_at desc);

create index if not exists home_survey_responses_email_idx
  on public.home_survey_responses (email);

create unique index if not exists home_survey_responses_visitor_id_idx
  on public.home_survey_responses (visitor_id);
