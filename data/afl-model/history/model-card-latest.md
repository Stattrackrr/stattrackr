# AFL Disposals Model Card

- Generated: 2026-08-08T17:20:53Z
- Model: afl-disp-20260808-171915
- Sample count: 739
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.45%, brier 0.264696, logloss 0.740555, clv+ 16.1%

## Confidence Buckets
- high_0.65_plus: n=202, hit=52.97%
- low: n=284, hit=53.52%
- mid_0.57_0.65: n=253, hit=53.75%

## Edge Buckets
- edge_5_8: n=130, hit=53.08%
- edge_8_plus: n=413, hit=54.0%
- edge_under_5: n=196, hit=52.55%

## Top Loss Types
- Under->Over: 224
- Over->Under: 120
