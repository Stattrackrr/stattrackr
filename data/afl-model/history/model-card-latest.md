# AFL Disposals Model Card

- Generated: 2026-07-11T11:56:00Z
- Model: afl-disp-20260711-115411
- Sample count: 1237
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.61%, brier 0.276212, logloss 0.773033, clv+ 20.05%

## Confidence Buckets
- high_0.65_plus: n=431, hit=51.28%
- low: n=429, hit=48.95%
- mid_0.57_0.65: n=377, hit=51.72%

## Edge Buckets
- edge_5_8: n=166, hit=53.61%
- edge_8_plus: n=752, hit=50.93%
- edge_under_5: n=319, hit=48.28%

## Top Loss Types
- Under->Over: 398
- Over->Under: 213
