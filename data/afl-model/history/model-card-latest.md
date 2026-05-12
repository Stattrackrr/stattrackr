# AFL Disposals Model Card

- Generated: 2026-05-12T13:06:42Z
- Model: afl-disp-20260512-130426
- Sample count: 900
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.0%, brier 0.244319, logloss 0.681442, clv+ 28.11%

## Confidence Buckets
- high_0.65_plus: n=60, hit=70.0%
- low: n=699, hit=52.22%
- mid_0.57_0.65: n=141, hit=62.41%

## Edge Buckets
- edge_5_8: n=59, hit=55.93%
- edge_8_plus: n=202, hit=64.85%
- edge_under_5: n=639, hit=51.8%

## Top Loss Types
- Under->Over: 394
- Over->Under: 11
