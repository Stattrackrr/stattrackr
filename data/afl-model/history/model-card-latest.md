# AFL Disposals Model Card

- Generated: 2026-08-13T17:50:14Z
- Model: afl-disp-20260813-174800
- Sample count: 598
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.68%, brier 0.265704, logloss 0.745147, clv+ 15.72%

## Confidence Buckets
- high_0.65_plus: n=175, hit=53.14%
- low: n=213, hit=52.11%
- mid_0.57_0.65: n=210, hit=52.86%

## Edge Buckets
- edge_5_8: n=107, hit=49.53%
- edge_8_plus: n=342, hit=52.92%
- edge_under_5: n=149, hit=54.36%

## Top Loss Types
- Under->Over: 189
- Over->Under: 94
