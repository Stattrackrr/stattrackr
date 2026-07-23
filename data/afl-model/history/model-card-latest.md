# AFL Disposals Model Card

- Generated: 2026-07-23T12:23:23Z
- Model: afl-disp-20260723-122211
- Sample count: 1086
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.01%, brier 0.275454, logloss 0.773013, clv+ 17.68%

## Confidence Buckets
- high_0.65_plus: n=388, hit=51.55%
- low: n=376, hit=48.4%
- mid_0.57_0.65: n=322, hit=53.42%

## Edge Buckets
- edge_5_8: n=139, hit=52.52%
- edge_8_plus: n=664, hit=52.26%
- edge_under_5: n=283, hit=47.35%

## Top Loss Types
- Under->Over: 348
- Over->Under: 184
