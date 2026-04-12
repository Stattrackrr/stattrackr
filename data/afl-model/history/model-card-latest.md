# AFL Disposals Model Card

- Generated: 2026-04-12T11:36:18Z
- Model: afl-disp-20260412-113258
- Sample count: 208
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 60.58%, brier 0.229979, logloss 0.648301, clv+ 29.81%

## Confidence Buckets
- high_0.65_plus: n=23, hit=86.96%
- low: n=74, hit=55.41%
- mid_0.57_0.65: n=111, hit=58.56%

## Edge Buckets
- edge_5_8: n=15, hit=40.0%
- edge_8_plus: n=122, hit=64.75%
- edge_under_5: n=71, hit=57.75%

## Top Loss Types
- Under->Over: 78
- Over->Under: 4
