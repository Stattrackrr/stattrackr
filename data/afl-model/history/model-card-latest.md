# AFL Disposals Model Card

- Generated: 2026-07-16T18:05:59Z
- Model: afl-disp-20260716-180203
- Sample count: 1097
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.14%, brier 0.265382, logloss 0.738, clv+ 17.78%

## Confidence Buckets
- high_0.65_plus: n=322, hit=51.24%
- low: n=413, hit=52.54%
- mid_0.57_0.65: n=362, hit=55.52%

## Edge Buckets
- edge_5_8: n=177, hit=51.98%
- edge_8_plus: n=628, hit=53.34%
- edge_under_5: n=292, hit=53.42%

## Top Loss Types
- Under->Over: 329
- Over->Under: 185
