# AFL Disposals Model Card

- Generated: 2026-07-04T12:12:35Z
- Model: afl-disp-20260704-120825
- Sample count: 1448
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.38%, brier 0.270776, logloss 0.763102, clv+ 21.62%

## Confidence Buckets
- high_0.65_plus: n=667, hit=55.62%
- low: n=399, hit=46.87%
- mid_0.57_0.65: n=382, hit=56.28%

## Edge Buckets
- edge_5_8: n=167, hit=41.32%
- edge_8_plus: n=995, hit=56.68%
- edge_under_5: n=286, hit=48.95%

## Top Loss Types
- Under->Over: 501
- Over->Under: 174
