# AFL Disposals Model Card

- Generated: 2026-09-09T15:09:16Z
- Model: afl-disp-20260909-150743
- Sample count: 270
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.74%, brier 0.287517, logloss 0.817952, clv+ 15.19%

## Confidence Buckets
- high_0.65_plus: n=106, hit=49.06%
- low: n=87, hit=51.72%
- mid_0.57_0.65: n=77, hit=51.95%

## Edge Buckets
- edge_5_8: n=41, hit=46.34%
- edge_8_plus: n=170, hit=50.59%
- edge_under_5: n=59, hit=54.24%

## Top Loss Types
- Under->Over: 105
- Over->Under: 28
