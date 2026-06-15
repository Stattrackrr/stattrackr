# AFL Disposals Model Card

- Generated: 2026-06-15T16:18:18Z
- Model: afl-disp-20260615-161524
- Sample count: 1625
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.09%, brier 0.249927, logloss 0.735417, clv+ 23.69%

## Confidence Buckets
- high_0.65_plus: n=36, hit=61.11%
- low: n=1414, hit=53.39%
- mid_0.57_0.65: n=175, hit=58.29%

## Edge Buckets
- edge_5_8: n=261, hit=52.87%
- edge_8_plus: n=213, hit=58.69%
- edge_under_5: n=1151, hit=53.52%

## Top Loss Types
- Under->Over: 630
- Over->Under: 116
