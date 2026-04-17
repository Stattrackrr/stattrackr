# AFL Disposals Model Card

- Generated: 2026-04-17T17:33:21Z
- Model: afl-disp-20260417-173044
- Sample count: 279
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 57.35%, brier 0.239805, logloss 0.711479, clv+ 28.32%

## Confidence Buckets
- high_0.65_plus: n=56, hit=75.0%
- low: n=138, hit=52.17%
- mid_0.57_0.65: n=85, hit=54.12%

## Edge Buckets
- edge_5_8: n=115, hit=55.65%
- edge_8_plus: n=147, hit=59.86%
- edge_under_5: n=17, hit=47.06%

## Top Loss Types
- Under->Over: 119
