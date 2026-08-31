# AFL Disposals Model Card

- Generated: 2026-08-31T17:54:21Z
- Model: afl-disp-20260831-175149
- Sample count: 387
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 48.06%, brier 0.279028, logloss 0.780187, clv+ 15.25%

## Confidence Buckets
- high_0.65_plus: n=142, hit=50.7%
- low: n=133, hit=42.11%
- mid_0.57_0.65: n=112, hit=51.79%

## Edge Buckets
- edge_5_8: n=61, hit=45.9%
- edge_8_plus: n=238, hit=52.1%
- edge_under_5: n=88, hit=38.64%

## Top Loss Types
- Under->Over: 147
- Over->Under: 54
