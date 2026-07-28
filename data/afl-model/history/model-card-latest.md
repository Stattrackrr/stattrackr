# AFL Disposals Model Card

- Generated: 2026-07-28T12:53:38Z
- Model: afl-disp-20260728-125224
- Sample count: 956
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.45%, brier 0.267996, logloss 0.749387, clv+ 15.17%

## Confidence Buckets
- high_0.65_plus: n=305, hit=50.82%
- low: n=335, hit=52.54%
- mid_0.57_0.65: n=316, hit=56.96%

## Edge Buckets
- edge_5_8: n=144, hit=53.47%
- edge_8_plus: n=585, hit=54.02%
- edge_under_5: n=227, hit=51.98%

## Top Loss Types
- Under->Over: 309
- Over->Under: 136
