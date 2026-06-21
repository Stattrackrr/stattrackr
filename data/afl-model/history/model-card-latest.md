# AFL Disposals Model Card

- Generated: 2026-06-21T18:20:42Z
- Model: afl-disp-20260621-181653
- Sample count: 1627
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.15%, brier 0.247547, logloss 0.694808, clv+ 21.08%

## Confidence Buckets
- high_0.65_plus: n=29, hit=68.97%
- low: n=1511, hit=53.47%
- mid_0.57_0.65: n=87, hit=60.92%

## Edge Buckets
- edge_5_8: n=324, hit=54.01%
- edge_8_plus: n=116, hit=63.79%
- edge_under_5: n=1187, hit=53.24%

## Top Loss Types
- Under->Over: 649
- Over->Under: 97
