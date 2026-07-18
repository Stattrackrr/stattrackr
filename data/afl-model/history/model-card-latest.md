# AFL Disposals Model Card

- Generated: 2026-07-18T17:48:05Z
- Model: afl-disp-20260718-174550
- Sample count: 1097
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.42%, brier 0.267245, logloss 0.742705, clv+ 18.05%

## Confidence Buckets
- high_0.65_plus: n=335, hit=52.24%
- low: n=426, hit=52.58%
- mid_0.57_0.65: n=336, hit=52.38%

## Edge Buckets
- edge_5_8: n=166, hit=52.41%
- edge_8_plus: n=629, hit=52.31%
- edge_under_5: n=302, hit=52.65%

## Top Loss Types
- Under->Over: 332
- Over->Under: 190
