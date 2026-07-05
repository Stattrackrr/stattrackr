# AFL Disposals Model Card

- Generated: 2026-07-05T17:58:32Z
- Model: afl-disp-20260705-175510
- Sample count: 1417
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.28%, brier 0.263842, logloss 0.739192, clv+ 19.48%

## Confidence Buckets
- high_0.65_plus: n=450, hit=54.22%
- low: n=511, hit=53.42%
- mid_0.57_0.65: n=456, hit=52.19%

## Edge Buckets
- edge_5_8: n=206, hit=53.88%
- edge_8_plus: n=829, hit=53.44%
- edge_under_5: n=382, hit=52.62%

## Top Loss Types
- Under->Over: 436
- Over->Under: 226
