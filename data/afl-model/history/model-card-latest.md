# AFL Disposals Model Card

- Generated: 2026-07-25T17:48:36Z
- Model: afl-disp-20260725-174520
- Sample count: 956
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 51.88%, brier 0.265929, logloss 0.740249, clv+ 16.32%

## Confidence Buckets
- high_0.65_plus: n=285, hit=53.33%
- low: n=379, hit=49.6%
- mid_0.57_0.65: n=292, hit=53.42%

## Edge Buckets
- edge_5_8: n=140, hit=48.57%
- edge_8_plus: n=536, hit=53.54%
- edge_under_5: n=280, hit=50.36%

## Top Loss Types
- Under->Over: 291
- Over->Under: 169
