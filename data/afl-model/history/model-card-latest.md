# AFL Disposals Model Card

- Generated: 2026-07-10T15:14:25Z
- Model: afl-disp-20260710-151100
- Sample count: 1255
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.23%, brier 0.269415, logloss 0.750655, clv+ 19.6%

## Confidence Buckets
- high_0.65_plus: n=437, hit=52.17%
- low: n=409, hit=53.06%
- mid_0.57_0.65: n=409, hit=54.52%

## Edge Buckets
- edge_5_8: n=175, hit=51.43%
- edge_8_plus: n=787, hit=53.24%
- edge_under_5: n=293, hit=54.27%

## Top Loss Types
- Under->Over: 411
- Over->Under: 176
