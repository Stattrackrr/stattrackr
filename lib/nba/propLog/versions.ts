/**
 * Frozen with the start of forward logging; any change bumps a version and starts a new sample.
 * inputs-v2: BettingPros defence-vs-position rank.
 * inputs-v3: minutes with tonight's information, pooled usage, implied-minutes gap.
 * inputs-v4: feature-library candidates (opponent absences, rest/travel, chances, combos, refs).
 * inputs-v5: news-age under-reaction candidates (ln minutes since relevant status change).
 * inputs-v6: three input bugs fixed (15 Nov 2026), so minutes, usage, rest and news inputs mean what
 *   they say from here on:
 *     1. Game logs were dated by UTC tip time but compared with tonight's US Eastern day. A true back
 *        to back lost the previous night's game from the player's history and the team's schedule, and
 *        "back to back" fired on one day of rest (55% of team games flagged against 18% real).
 *     2. Starter flags were read 1,000 rows at a time without paging, so only about a quarter of the
 *        season's games had them. "Promoted to starter" / "moved to the bench" then fired off stale
 *        flags and moved expected minutes by up to 24% the wrong way.
 *     3. News age read a change time the live injury report doesn't carry, so it was empty on every
 *        t2h and injury_change snapshot. It now comes from the logged status changes, measured to the
 *        moment of the snapshot, with the direction of the change.
 *   Would-be bets under v0-market don't use these inputs (the market's weight is 1, every feature 0),
 *   so that sample is unaffected. Fits on these inputs should use inputs-v6 lines (see
 *   CLEAN_FEATURE_VERSIONS).
 */
export const PROP_LOG_VERSIONS = { model: 'none', feature: 'inputs-v6', policy: 'log-v1' } as const;

/** Feature versions whose minutes, usage, rest and news inputs are sound. Extend on the next bump unless it breaks them. */
export const CLEAN_FEATURE_VERSIONS: readonly string[] = ['inputs-v6'];
