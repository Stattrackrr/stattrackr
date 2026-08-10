# AFL Disposals Model Card

- Generated: 2026-08-10T11:45:53Z
- Model: afl-disp-20260810-114452
- Sample count: 739
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.69%, brier 0.275707, logloss 0.777887, clv+ 16.78%

## Confidence Buckets
- high_0.65_plus: n=250, hit=52.4%
- low: n=258, hit=52.71%
- mid_0.57_0.65: n=231, hit=49.78%

## Edge Buckets
- edge_5_8: n=107, hit=52.34%
- edge_8_plus: n=445, hit=51.46%
- edge_under_5: n=187, hit=51.87%

## Top Loss Types
- Under->Over: 234
- Over->Under: 123
