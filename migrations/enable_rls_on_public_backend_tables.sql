-- Lock down public backend/cache tables that Supabase Advisor flags as
-- "RLS Disabled in Public". These are service-role only: the anon key is in
-- the browser, so enabling RLS with no policies denies public REST access.
-- The service_role key bypasses RLS and keeps API routes / ingest scripts working.
--
-- Also convert active_tracked_props to security invoker so it inherits
-- tracked_props row policies instead of running as the view owner.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'arena_factors',
    'coach_tendencies',
    'player_contracts',
    'nba_api_cache',
    'dvp_rank_snapshots',
    'national_tv_games',
    'referee_stats',
    'model_performance',
    'player_former_teams',
    'prediction_cache',
    'player_game_stats',
    'afl_rank_snapshots',
    'international_teams',
    'international_competitions',
    'international_matches',
    'international_players',
    'international_player_match_stats',
    'international_player_earnings',
    'international_team_match_stats',
    'international_player_warnings',
    'world_cup_cache'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.active_tracked_props') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.active_tracked_props SET (security_invoker = true)';
  END IF;
END $$;
