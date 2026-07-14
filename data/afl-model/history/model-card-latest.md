# AFL Disposals Model Card

- Generated: 2026-07-14T12:20:21Z
- Model: afl-disp-20260714-121234
- Sample count: 1210
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.33%, brier 0.277259, logloss 0.775847, clv+ 19.92%

## Confidence Buckets
- high_0.65_plus: n=422, hit=50.95%
- low: n=415, hit=48.67%
- mid_0.57_0.65: n=373, hit=51.47%

## Edge Buckets
- edge_5_8: n=164, hit=53.66%
- edge_8_plus: n=737, hit=50.61%
- edge_under_5: n=309, hit=47.9%

## Top Loss Types
- Under->Over: 393
- Over->Under: 208
