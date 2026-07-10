# AFL Disposals Model Card

- Generated: 2026-07-10T13:18:22Z
- Model: afl-disp-20260710-131348
- Sample count: 1255
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.15%, brier 0.266563, logloss 0.742735, clv+ 19.68%

## Confidence Buckets
- high_0.65_plus: n=389, hit=52.19%
- low: n=455, hit=53.63%
- mid_0.57_0.65: n=411, hit=53.53%

## Edge Buckets
- edge_5_8: n=176, hit=58.52%
- edge_8_plus: n=743, hit=52.36%
- edge_under_5: n=336, hit=52.08%

## Top Loss Types
- Under->Over: 379
- Over->Under: 209
