# AFL Disposals Model Card

- Generated: 2026-06-19T14:03:31Z
- Model: afl-disp-20260619-140057
- Sample count: 1578
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.2%, brier 0.246378, logloss 0.70668, clv+ 23.07%

## Confidence Buckets
- high_0.65_plus: n=20, hit=80.0%
- low: n=1413, hit=54.14%
- mid_0.57_0.65: n=145, hit=62.07%

## Edge Buckets
- edge_5_8: n=835, hit=53.53%
- edge_8_plus: n=250, hit=60.8%
- edge_under_5: n=493, hit=55.17%

## Top Loss Types
- Under->Over: 505
- Over->Under: 202
