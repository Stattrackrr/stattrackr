# AFL Disposals Model Card

- Generated: 2026-09-14T20:43:12Z
- Model: afl-disp-20260914-204138
- Sample count: 145
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 49.66%, brier 0.289739, logloss 0.79556, clv+ 13.79%

## Confidence Buckets
- high_0.65_plus: n=43, hit=39.53%
- low: n=50, hit=50.0%
- mid_0.57_0.65: n=52, hit=57.69%

## Edge Buckets
- edge_5_8: n=24, hit=54.17%
- edge_8_plus: n=88, hit=46.59%
- edge_under_5: n=33, hit=54.55%

## Top Loss Types
- Under->Over: 53
- Over->Under: 20
