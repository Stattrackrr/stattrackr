# AFL Disposals Model Card

- Generated: 2026-05-19T13:57:37Z
- Model: afl-disp-20260519-135531
- Sample count: 1041
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.95%, brier 0.244121, logloss 0.680865, clv+ 28.82%

## Confidence Buckets
- high_0.65_plus: n=175, hit=68.0%
- low: n=853, hit=52.4%
- mid_0.57_0.65: n=13, hit=46.15%

## Edge Buckets
- edge_5_8: n=192, hit=50.0%
- edge_8_plus: n=192, hit=66.15%
- edge_under_5: n=657, hit=53.12%

## Top Loss Types
- Under->Over: 376
- Over->Under: 93
