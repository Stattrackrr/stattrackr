# AFL Disposals Model Card

- Generated: 2026-05-31T12:17:44Z
- Model: afl-disp-20260531-121044
- Sample count: 1399
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.25%, brier 0.245078, logloss 0.6831, clv+ 26.02%

## Confidence Buckets
- high_0.65_plus: n=67, hit=68.66%
- low: n=1039, hit=55.15%
- mid_0.57_0.65: n=293, hit=57.34%

## Edge Buckets
- edge_5_8: n=609, hit=56.98%
- edge_8_plus: n=336, hit=58.04%
- edge_under_5: n=454, hit=53.96%

## Top Loss Types
- Under->Over: 435
- Over->Under: 177
