# AFL Disposals Model Card

- Generated: 2026-05-04T12:22:55Z
- Model: afl-disp-20260504-122144
- Sample count: 742
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 57.14%, brier 0.239902, logloss 0.672019, clv+ 27.9%

## Confidence Buckets
- high_0.65_plus: n=124, hit=71.77%
- low: n=434, hit=52.3%
- mid_0.57_0.65: n=184, hit=58.7%

## Edge Buckets
- edge_5_8: n=14, hit=64.29%
- edge_8_plus: n=299, hit=63.55%
- edge_under_5: n=429, hit=52.45%

## Top Loss Types
- Under->Over: 261
- Over->Under: 57
