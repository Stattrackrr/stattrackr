# AFL Disposals Model Card

- Generated: 2026-07-16T12:31:16Z
- Model: afl-disp-20260716-122322
- Sample count: 1136
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 52.29%, brier 0.268491, logloss 0.74862, clv+ 18.75%

## Confidence Buckets
- high_0.65_plus: n=374, hit=51.34%
- low: n=383, hit=50.39%
- mid_0.57_0.65: n=379, hit=55.15%

## Edge Buckets
- edge_5_8: n=144, hit=52.08%
- edge_8_plus: n=708, hit=53.39%
- edge_under_5: n=284, hit=49.65%

## Top Loss Types
- Under->Over: 359
- Over->Under: 183
