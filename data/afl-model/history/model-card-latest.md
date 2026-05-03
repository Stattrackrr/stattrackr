# AFL Disposals Model Card

- Generated: 2026-05-03T17:34:04Z
- Model: afl-disp-20260503-173139
- Sample count: 742
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.33%, brier 0.241459, logloss 0.675471, clv+ 28.71%

## Confidence Buckets
- high_0.65_plus: n=99, hit=73.74%
- low: n=555, hit=53.33%
- mid_0.57_0.65: n=88, hit=55.68%

## Edge Buckets
- edge_5_8: n=116, hit=54.31%
- edge_8_plus: n=180, hit=65.56%
- edge_under_5: n=446, hit=53.14%

## Top Loss Types
- Under->Over: 309
- Over->Under: 15
