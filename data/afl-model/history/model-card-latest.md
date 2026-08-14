# AFL Disposals Model Card

- Generated: 2026-08-14T17:43:00Z
- Model: afl-disp-20260814-174121
- Sample count: 598
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.01%, brier 0.266854, logloss 0.746444, clv+ 15.05%

## Confidence Buckets
- high_0.65_plus: n=179, hit=52.51%
- low: n=225, hit=52.0%
- mid_0.57_0.65: n=194, hit=51.55%

## Edge Buckets
- edge_5_8: n=98, hit=55.1%
- edge_8_plus: n=343, hit=51.6%
- edge_under_5: n=157, hit=50.96%

## Top Loss Types
- Under->Over: 192
- Over->Under: 95
