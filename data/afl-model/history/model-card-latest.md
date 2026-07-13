# AFL Disposals Model Card

- Generated: 2026-07-13T18:43:01Z
- Model: afl-disp-20260713-183625
- Sample count: 1210
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 51.65%, brier 0.268918, logloss 0.747523, clv+ 19.59%

## Confidence Buckets
- high_0.65_plus: n=375, hit=52.27%
- low: n=407, hit=50.86%
- mid_0.57_0.65: n=428, hit=51.87%

## Edge Buckets
- edge_5_8: n=164, hit=50.61%
- edge_8_plus: n=734, hit=51.91%
- edge_under_5: n=312, hit=51.6%

## Top Loss Types
- Under->Over: 372
- Over->Under: 213
