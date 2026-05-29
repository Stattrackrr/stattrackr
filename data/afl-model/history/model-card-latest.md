# AFL Disposals Model Card

- Generated: 2026-05-29T19:08:48Z
- Model: afl-disp-20260529-190411
- Sample count: 1278
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.85%, brier 0.24598, logloss 0.68479, clv+ 25.59%

## Confidence Buckets
- high_0.65_plus: n=144, hit=63.89%
- low: n=1033, hit=52.86%
- mid_0.57_0.65: n=101, hit=62.38%

## Edge Buckets
- edge_5_8: n=26, hit=42.31%
- edge_8_plus: n=244, hit=63.11%
- edge_under_5: n=1008, hit=53.17%

## Top Loss Types
- Under->Over: 498
- Over->Under: 79
