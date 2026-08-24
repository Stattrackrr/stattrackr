# AFL Disposals Model Card

- Generated: 2026-08-24T11:24:57Z
- Model: afl-disp-20260824-112404
- Sample count: 445
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.24%, brier 0.279075, logloss 0.800845, clv+ 13.26%

## Confidence Buckets
- high_0.65_plus: n=158, hit=51.9%
- low: n=150, hit=50.0%
- mid_0.57_0.65: n=137, hit=51.82%

## Edge Buckets
- edge_5_8: n=69, hit=49.28%
- edge_8_plus: n=272, hit=52.21%
- edge_under_5: n=104, hit=50.0%

## Top Loss Types
- Under->Over: 156
- Over->Under: 61
