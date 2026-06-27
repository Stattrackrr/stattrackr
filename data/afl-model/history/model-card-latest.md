# AFL Disposals Model Card

- Generated: 2026-06-27T12:14:24Z
- Model: afl-disp-20260627-120803
- Sample count: 1549
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.45%, brier 0.249648, logloss 0.71511, clv+ 21.63%

## Confidence Buckets
- high_0.65_plus: n=12, hit=50.0%
- low: n=1382, hit=52.89%
- mid_0.57_0.65: n=155, hit=58.71%

## Edge Buckets
- edge_5_8: n=59, hit=57.63%
- edge_8_plus: n=154, hit=58.44%
- edge_under_5: n=1336, hit=52.69%

## Top Loss Types
- Under->Over: 642
- Over->Under: 79
