# AFL Disposals Model Card

- Generated: 2026-06-15T20:22:37Z
- Model: afl-disp-20260615-201719
- Sample count: 1625
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.58%, brier 0.246702, logloss 0.686329, clv+ 23.26%

## Confidence Buckets
- high_0.65_plus: n=34, hit=70.59%
- low: n=1380, hit=53.55%
- mid_0.57_0.65: n=211, hit=58.77%

## Edge Buckets
- edge_5_8: n=864, hit=53.24%
- edge_8_plus: n=254, hit=60.24%
- edge_under_5: n=507, hit=54.04%

## Top Loss Types
- Under->Over: 546
- Over->Under: 192
