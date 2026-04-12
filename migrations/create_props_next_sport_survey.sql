-- One-response-per-user survey for the props page.
-- Results are stored server-side only and read back through admin endpoints.

create table if not exists public.props_next_sport_survey_votes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  selected_sport text not null check (selected_sport in ('Tennis', 'Soccer', 'MLB', 'Esports')),
  source_page text not null default 'props',
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint props_next_sport_survey_votes_user_id_key unique (user_id)
);

alter table public.props_next_sport_survey_votes enable row level security;

revoke all on public.props_next_sport_survey_votes from anon;
revoke all on public.props_next_sport_survey_votes from authenticated;

create index if not exists props_next_sport_survey_votes_selected_sport_idx
  on public.props_next_sport_survey_votes (selected_sport);

create index if not exists props_next_sport_survey_votes_created_at_idx
  on public.props_next_sport_survey_votes (created_at desc);
