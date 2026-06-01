# AFL Disposals Model Card

- Generated: 2026-06-01T16:38:48Z
- Model: afl-disp-20260601-163659
- Sample count: 1399
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.75%, brier 0.245103, logloss 0.682913, clv+ 25.66%

## Confidence Buckets
- high_0.65_plus: n=115, hit=66.09%
- low: n=1225, hit=53.06%
- mid_0.57_0.65: n=59, hit=67.8%

## Edge Buckets
- edge_5_8: n=535, hit=53.46%
- edge_8_plus: n=186, hit=66.67%
- edge_under_5: n=678, hit=52.51%

## Top Loss Types
- Under->Over: 594
- Over->Under: 39
