# AFL Disposals Model Card

- Generated: 2026-07-17T17:58:14Z
- Model: afl-disp-20260717-175353
- Sample count: 1097
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.05%, brier 0.266574, logloss 0.740345, clv+ 18.05%

## Confidence Buckets
- high_0.65_plus: n=330, hit=51.82%
- low: n=423, hit=53.9%
- mid_0.57_0.65: n=344, hit=53.2%

## Edge Buckets
- edge_5_8: n=189, hit=55.03%
- edge_8_plus: n=623, hit=52.17%
- edge_under_5: n=285, hit=53.68%

## Top Loss Types
- Under->Over: 328
- Over->Under: 187
