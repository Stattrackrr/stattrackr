# AFL Disposals Model Card

- Generated: 2026-04-29T12:18:26Z
- Model: afl-disp-20260429-121643
- Sample count: 549
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 57.01%, brier 0.242293, logloss 0.67685, clv+ 30.97%

## Confidence Buckets
- high_0.65_plus: n=8, hit=75.0%
- low: n=264, hit=53.03%
- mid_0.57_0.65: n=277, hit=60.29%

## Edge Buckets
- edge_5_8: n=76, hit=56.58%
- edge_8_plus: n=207, hit=62.32%
- edge_under_5: n=266, hit=53.01%

## Top Loss Types
- Over->Under: 136
- Under->Over: 100
