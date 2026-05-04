# AFL Disposals Model Card

- Generated: 2026-05-04T18:17:33Z
- Model: afl-disp-20260504-181604
- Sample count: 742
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.2%, brier 0.240853, logloss 0.674308, clv+ 29.11%

## Confidence Buckets
- high_0.65_plus: n=150, hit=70.0%
- low: n=568, hit=52.46%
- mid_0.57_0.65: n=24, hit=58.33%

## Edge Buckets
- edge_5_8: n=97, hit=53.61%
- edge_8_plus: n=154, hit=69.48%
- edge_under_5: n=491, hit=52.55%

## Top Loss Types
- Under->Over: 309
- Over->Under: 16
