# AFL Disposals Model Card

- Generated: 2026-06-19T18:33:54Z
- Model: afl-disp-20260619-183138
- Sample count: 1578
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.06%, brier 0.246928, logloss 0.69391, clv+ 21.86%

## Confidence Buckets
- high_0.65_plus: n=59, hit=67.8%
- low: n=1375, hit=53.24%
- mid_0.57_0.65: n=144, hit=56.25%

## Edge Buckets
- edge_5_8: n=299, hit=57.53%
- edge_8_plus: n=114, hit=64.04%
- edge_under_5: n=1165, hit=52.19%

## Top Loss Types
- Under->Over: 678
- Over->Under: 47
