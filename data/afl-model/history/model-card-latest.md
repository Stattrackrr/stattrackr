# AFL Disposals Model Card

- Generated: 2026-05-17T12:03:23Z
- Model: afl-disp-20260517-120016
- Sample count: 1041
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.75%, brier 0.245166, logloss 0.68304, clv+ 28.63%

## Confidence Buckets
- high_0.65_plus: n=4, hit=75.0%
- low: n=648, hit=50.93%
- mid_0.57_0.65: n=389, hit=60.93%

## Edge Buckets
- edge_5_8: n=61, hit=63.93%
- edge_8_plus: n=382, hit=59.95%
- edge_under_5: n=598, hit=50.5%

## Top Loss Types
- Under->Over: 442
- Over->Under: 29
