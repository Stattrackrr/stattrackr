# AFL Disposals Model Card

- Generated: 2026-05-16T17:52:43Z
- Model: afl-disp-20260516-174901
- Sample count: 990
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.94%, brier 0.245468, logloss 0.683991, clv+ 26.87%

## Confidence Buckets
- high_0.65_plus: n=154, hit=64.94%
- low: n=755, hit=50.99%
- mid_0.57_0.65: n=81, hit=60.49%

## Edge Buckets
- edge_5_8: n=6, hit=16.67%
- edge_8_plus: n=230, hit=64.35%
- edge_under_5: n=754, hit=51.06%

## Top Loss Types
- Under->Over: 373
- Over->Under: 83
