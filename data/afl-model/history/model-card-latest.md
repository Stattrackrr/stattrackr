# AFL Disposals Model Card

- Generated: 2026-05-11T18:35:09Z
- Model: afl-disp-20260511-183217
- Sample count: 900
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.89%, brier 0.243657, logloss 0.680202, clv+ 27.44%

## Confidence Buckets
- high_0.65_plus: n=133, hit=69.17%
- low: n=713, hit=51.75%
- mid_0.57_0.65: n=54, hit=61.11%

## Edge Buckets
- edge_5_8: n=33, hit=57.58%
- edge_8_plus: n=171, hit=67.84%
- edge_under_5: n=696, hit=51.58%

## Top Loss Types
- Under->Over: 379
- Over->Under: 27
