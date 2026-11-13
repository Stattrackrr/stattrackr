/**
 * Frozen with the start of forward logging; any change bumps a version and starts a new sample.
 * inputs-v2: BettingPros defence-vs-position rank.
 * inputs-v3: minutes with tonight's information, pooled usage, implied-minutes gap.
 * inputs-v4: feature-library candidates (opponent absences, rest/travel, chances, combos, refs).
 * inputs-v5: news-age under-reaction candidates (ln minutes since relevant status change).
 */
export const PROP_LOG_VERSIONS = { model: 'none', feature: 'inputs-v5', policy: 'log-v1' } as const;
