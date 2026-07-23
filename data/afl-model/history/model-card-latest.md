# AFL Disposals Model Card

- Generated: 2026-07-23T18:13:50Z
- Model: afl-disp-20260723-181153
- Sample count: 1057
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.17%, brier 0.263492, logloss 0.735278, clv+ 17.79%

## Confidence Buckets
- high_0.65_plus: n=312, hit=51.92%
- low: n=404, hit=52.72%
- mid_0.57_0.65: n=341, hit=54.84%

## Edge Buckets
- edge_5_8: n=173, hit=56.65%
- edge_8_plus: n=599, hit=53.09%
- edge_under_5: n=285, hit=51.23%

## Top Loss Types
- Under->Over: 304
- Over->Under: 191
