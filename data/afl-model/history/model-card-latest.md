# AFL Disposals Model Card

- Generated: 2026-07-25T12:03:17Z
- Model: afl-disp-20260725-120144
- Sample count: 1006
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.59%, brier 0.272903, logloss 0.765934, clv+ 17.69%

## Confidence Buckets
- high_0.65_plus: n=353, hit=52.69%
- low: n=345, hit=48.41%
- mid_0.57_0.65: n=308, hit=53.9%

## Edge Buckets
- edge_5_8: n=138, hit=52.17%
- edge_8_plus: n=610, hit=53.11%
- edge_under_5: n=258, hit=47.67%

## Top Loss Types
- Under->Over: 315
- Over->Under: 172
