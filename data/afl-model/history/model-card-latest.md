# AFL Disposals Model Card

- Generated: 2026-06-14T18:17:25Z
- Model: afl-disp-20260614-181313
- Sample count: 1625
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.22%, brier 0.247583, logloss 0.688227, clv+ 23.14%

## Confidence Buckets
- high_0.65_plus: n=23, hit=69.57%
- low: n=1502, hit=53.4%
- mid_0.57_0.65: n=100, hit=63.0%

## Edge Buckets
- edge_5_8: n=821, hit=53.11%
- edge_8_plus: n=188, hit=61.17%
- edge_under_5: n=616, hit=53.57%

## Top Loss Types
- Under->Over: 587
- Over->Under: 157
