# AFL Disposals Model Card

- Generated: 2026-08-21T17:17:00Z
- Model: afl-disp-20260821-171511
- Sample count: 555
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.33%, brier 0.265699, logloss 0.745343, clv+ 15.68%

## Confidence Buckets
- high_0.65_plus: n=177, hit=53.67%
- low: n=211, hit=54.98%
- mid_0.57_0.65: n=167, hit=50.9%

## Edge Buckets
- edge_5_8: n=102, hit=52.94%
- edge_8_plus: n=315, hit=52.38%
- edge_under_5: n=138, hit=55.8%

## Top Loss Types
- Under->Over: 173
- Over->Under: 86
