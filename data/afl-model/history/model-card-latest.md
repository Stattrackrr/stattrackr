# AFL Disposals Model Card

- Generated: 2026-07-09T18:43:20Z
- Model: afl-disp-20260709-183618
- Sample count: 1255
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.07%, brier 0.268176, logloss 0.745684, clv+ 18.57%

## Confidence Buckets
- high_0.65_plus: n=414, hit=52.17%
- low: n=440, hit=55.68%
- mid_0.57_0.65: n=401, hit=51.12%

## Edge Buckets
- edge_5_8: n=172, hit=50.58%
- edge_8_plus: n=761, hit=52.17%
- edge_under_5: n=322, hit=56.52%

## Top Loss Types
- Under->Over: 374
- Over->Under: 215
