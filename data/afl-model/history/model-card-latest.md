# AFL Disposals Model Card

- Generated: 2026-07-15T12:23:37Z
- Model: afl-disp-20260715-121628
- Sample count: 1136
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.17%, brier 0.272534, logloss 0.761278, clv+ 17.69%

## Confidence Buckets
- high_0.65_plus: n=454, hit=51.98%
- low: n=337, hit=53.41%
- mid_0.57_0.65: n=345, hit=54.49%

## Edge Buckets
- edge_5_8: n=149, hit=53.02%
- edge_8_plus: n=755, hit=52.72%
- edge_under_5: n=232, hit=54.74%

## Top Loss Types
- Under->Over: 395
- Over->Under: 137
