# AFL Disposals Model Card

- Generated: 2026-06-11T19:40:56Z
- Model: afl-disp-20260611-193504
- Sample count: 1521
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.49%, brier 0.245945, logloss 0.684744, clv+ 23.34%

## Confidence Buckets
- high_0.65_plus: n=56, hit=66.07%
- low: n=1247, hit=54.13%
- mid_0.57_0.65: n=218, hit=60.55%

## Edge Buckets
- edge_5_8: n=269, hit=50.19%
- edge_8_plus: n=274, hit=62.04%
- edge_under_5: n=978, hit=55.11%

## Top Loss Types
- Under->Over: 527
- Over->Under: 150
