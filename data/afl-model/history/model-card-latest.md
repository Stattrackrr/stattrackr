# AFL Disposals Model Card

- Generated: 2026-09-10T19:30:59Z
- Model: afl-disp-20260910-192933
- Sample count: 250
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 46.8%, brier 0.290737, logloss 0.805876, clv+ 18.0%

## Confidence Buckets
- high_0.65_plus: n=90, hit=45.56%
- low: n=76, hit=48.68%
- mid_0.57_0.65: n=84, hit=46.43%

## Edge Buckets
- edge_5_8: n=41, hit=51.22%
- edge_8_plus: n=155, hit=46.45%
- edge_under_5: n=54, hit=44.44%

## Top Loss Types
- Under->Over: 94
- Over->Under: 39
