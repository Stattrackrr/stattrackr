-- Team-level match statistics for international competitions.
--
-- The per-player table (international_player_match_stats) only lets us sum a
-- handful of stats up to the team level. Team-only betting markets — corners,
-- ball possession, offsides, shot location splits, throw-ins, etc. — are not
-- derivable from player rows, so we store them here per (match, team).
--
-- Column names intentionally mirror the BalldontLie FIFA `team_match_stats`
-- shape so the World Cup dashboard can treat every competition uniformly. Every
-- metric is nullable: each source fills only what it actually provides, and the
-- dashboard's "symmetric coverage" filter shows a stat only when every shown
-- competition has it.

create table if not exists public.international_team_match_stats (
  id                  bigint generated always as identity primary key,
  source              text        not null,            -- 'statsbomb' | 'api-football'
  source_match_id     text        not null,
  source_team_id      text        not null,
  tournament_slug     text,
  season_year         integer,
  is_home             boolean,

  -- Scoring / chances
  goals               numeric,
  expected_goals      numeric,
  big_chances         numeric,
  big_chances_missed  numeric,

  -- Shooting
  shots_total         numeric,
  shots_on_target     numeric,
  shots_off_target    numeric,
  shots_blocked       numeric,
  shots_inside_box    numeric,
  shots_outside_box   numeric,
  hit_woodwork        numeric,

  -- Set pieces / discipline
  corners             numeric,
  offsides            numeric,
  fouls               numeric,
  yellow_cards        numeric,
  red_cards           numeric,
  throw_ins           numeric,
  goal_kicks          numeric,
  free_kicks          numeric,

  -- Passing
  possession_pct      numeric,
  passes_total        numeric,
  passes_accurate     numeric,
  passes_final_third  numeric,
  long_balls_total    numeric,
  long_balls_accurate numeric,
  crosses_total       numeric,
  crosses_accurate    numeric,

  -- Defending / duels
  tackles             numeric,
  interceptions       numeric,
  clearances          numeric,
  saves               numeric,
  ground_duels_won    numeric,
  ground_duels_total  numeric,
  aerial_duels_won    numeric,
  aerial_duels_total  numeric,
  dribbles_completed  numeric,
  dribbles_total      numeric,

  raw_aggregates      jsonb,
  fetched_at          timestamptz not null default now(),

  constraint international_team_match_stats_unique
    unique (source, source_match_id, source_team_id)
);

create index if not exists international_team_match_stats_match_idx
  on public.international_team_match_stats (source, source_match_id);

create index if not exists international_team_match_stats_team_idx
  on public.international_team_match_stats (source, source_team_id);

-- Service role handles all reads/writes for this table (same as the other
-- international_* tables); enable RLS with no public policies.
alter table public.international_team_match_stats enable row level security;
