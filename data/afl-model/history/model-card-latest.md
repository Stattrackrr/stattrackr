# AFL Disposals Model Card

- Generated: 2026-07-17T12:08:43Z
- Model: afl-disp-20260717-120703
- Sample count: 1097
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.96%, brier 0.272116, logloss 0.756944, clv+ 18.32%

## Confidence Buckets
- high_0.65_plus: n=390, hit=51.03%
- low: n=363, hit=49.31%
- mid_0.57_0.65: n=344, hit=55.81%

## Edge Buckets
- edge_5_8: n=138, hit=52.17%
- edge_8_plus: n=694, hit=53.03%
- edge_under_5: n=265, hit=49.06%

## Top Loss Types
- Under->Over: 368
- Over->Under: 159
