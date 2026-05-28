# AFL Disposals Model Card

- Generated: 2026-05-28T14:39:36Z
- Model: afl-disp-20260528-143603
- Sample count: 1255
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.86%, brier 0.244222, logloss 0.681111, clv+ 27.57%

## Confidence Buckets
- high_0.65_plus: n=123, hit=69.92%
- low: n=1132, hit=54.33%

## Edge Buckets
- edge_5_8: n=356, hit=52.25%
- edge_8_plus: n=131, hit=71.76%
- edge_under_5: n=768, hit=54.82%

## Top Loss Types
- Under->Over: 396
- Over->Under: 158
