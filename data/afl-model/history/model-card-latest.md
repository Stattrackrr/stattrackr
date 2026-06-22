# AFL Disposals Model Card

- Generated: 2026-06-22T20:14:28Z
- Model: afl-disp-20260622-200959
- Sample count: 1627
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.21%, brier 0.247762, logloss 0.688654, clv+ 21.51%

## Confidence Buckets
- high_0.65_plus: n=33, hit=69.7%
- low: n=1585, hit=53.88%
- mid_0.57_0.65: n=9, hit=55.56%

## Edge Buckets
- edge_5_8: n=224, hit=57.14%
- edge_8_plus: n=38, hit=71.05%
- edge_under_5: n=1365, hit=53.26%

## Top Loss Types
- Under->Over: 541
- Over->Under: 204
