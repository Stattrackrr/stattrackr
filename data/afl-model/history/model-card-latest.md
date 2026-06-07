# AFL Disposals Model Card

- Generated: 2026-06-07T18:07:03Z
- Model: afl-disp-20260607-180253
- Sample count: 1552
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.9%, brier 0.246448, logloss 0.685841, clv+ 23.9%

## Confidence Buckets
- high_0.65_plus: n=19, hit=78.95%
- low: n=1313, hit=53.85%
- mid_0.57_0.65: n=220, hit=59.09%

## Edge Buckets
- edge_5_8: n=263, hit=49.81%
- edge_8_plus: n=229, hit=61.14%
- edge_under_5: n=1060, hit=54.81%

## Top Loss Types
- Under->Over: 583
- Over->Under: 117
