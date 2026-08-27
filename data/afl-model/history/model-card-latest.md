# AFL Disposals Model Card

- Generated: 2026-08-27T20:56:53Z
- Model: afl-disp-20260827-205549
- Sample count: 428
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.4%, brier 0.27864, logloss 0.79945, clv+ 13.55%

## Confidence Buckets
- high_0.65_plus: n=151, hit=50.99%
- low: n=145, hit=49.66%
- mid_0.57_0.65: n=132, hit=53.79%

## Edge Buckets
- edge_5_8: n=63, hit=52.38%
- edge_8_plus: n=259, hit=52.12%
- edge_under_5: n=106, hit=49.06%

## Top Loss Types
- Under->Over: 150
- Over->Under: 58
