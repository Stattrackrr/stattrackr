# AFL Disposals Model Card

- Generated: 2026-06-20T12:33:02Z
- Model: afl-disp-20260620-122702
- Sample count: 1588
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.09%, brier 0.247889, logloss 0.702941, clv+ 23.36%

## Confidence Buckets
- high_0.65_plus: n=16, hit=68.75%
- low: n=1397, hit=53.19%
- mid_0.57_0.65: n=175, hit=60.0%

## Edge Buckets
- edge_5_8: n=789, hit=52.73%
- edge_8_plus: n=90, hit=65.56%
- edge_under_5: n=709, hit=54.16%

## Top Loss Types
- Under->Over: 513
- Over->Under: 216
