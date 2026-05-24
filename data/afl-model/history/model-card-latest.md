# AFL Disposals Model Card

- Generated: 2026-05-24T17:51:57Z
- Model: afl-disp-20260524-174750
- Sample count: 1233
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.91%, brier 0.24619, logloss 0.685452, clv+ 26.6%

## Confidence Buckets
- high_0.65_plus: n=41, hit=65.85%
- low: n=937, hit=52.93%
- mid_0.57_0.65: n=255, hit=60.39%

## Edge Buckets
- edge_5_8: n=41, hit=41.46%
- edge_8_plus: n=295, hit=61.36%
- edge_under_5: n=897, hit=53.4%

## Top Loss Types
- Under->Over: 536
- Over->Under: 20
