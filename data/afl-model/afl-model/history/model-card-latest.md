# AFL Disposals Model Card

- Generated: 2026-07-04T17:56:53Z
- Model: afl-disp-20260704-175247
- Sample count: 1448
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.59%, brier 0.265914, logloss 0.745992, clv+ 20.86%

## Confidence Buckets
- high_0.65_plus: n=502, hit=53.59%
- low: n=492, hit=51.83%
- mid_0.57_0.65: n=454, hit=55.51%

## Edge Buckets
- edge_5_8: n=190, hit=53.16%
- edge_8_plus: n=898, hit=54.23%
- edge_under_5: n=360, hit=52.22%

## Top Loss Types
- Under->Over: 436
- Over->Under: 236
