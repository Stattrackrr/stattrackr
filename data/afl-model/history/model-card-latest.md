# AFL Disposals Model Card

- Generated: 2026-07-11T17:52:29Z
- Model: afl-disp-20260711-174828
- Sample count: 1237
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.06%, brier 0.265994, logloss 0.740757, clv+ 18.92%

## Confidence Buckets
- high_0.65_plus: n=368, hit=51.9%
- low: n=474, hit=50.63%
- mid_0.57_0.65: n=395, hit=53.92%

## Edge Buckets
- edge_5_8: n=203, hit=53.2%
- edge_8_plus: n=700, hit=52.29%
- edge_under_5: n=334, hit=50.9%

## Top Loss Types
- Under->Over: 379
- Over->Under: 214
