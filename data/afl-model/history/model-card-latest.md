# AFL Disposals Model Card

- Generated: 2026-05-28T19:09:24Z
- Model: afl-disp-20260528-190521
- Sample count: 1255
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.98%, brier 0.245623, logloss 0.684249, clv+ 24.54%

## Confidence Buckets
- high_0.65_plus: n=154, hit=66.88%
- low: n=1019, hit=53.29%
- mid_0.57_0.65: n=82, hit=53.66%

## Edge Buckets
- edge_5_8: n=208, hit=51.92%
- edge_8_plus: n=181, hit=65.19%
- edge_under_5: n=866, hit=53.58%

## Top Loss Types
- Under->Over: 443
- Over->Under: 122
