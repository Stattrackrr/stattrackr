# AFL Disposals Model Card

- Generated: 2026-06-04T18:56:34Z
- Model: afl-disp-20260604-185125
- Sample count: 1420
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.93%, brier 0.246272, logloss 0.685521, clv+ 24.65%

## Confidence Buckets
- high_0.65_plus: n=7, hit=71.43%
- low: n=1205, hit=53.61%
- mid_0.57_0.65: n=208, hit=62.02%

## Edge Buckets
- edge_5_8: n=253, hit=52.57%
- edge_8_plus: n=218, hit=61.93%
- edge_under_5: n=949, hit=53.95%

## Top Loss Types
- Under->Over: 500
- Over->Under: 140
