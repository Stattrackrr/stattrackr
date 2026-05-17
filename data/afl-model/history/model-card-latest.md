# AFL Disposals Model Card

- Generated: 2026-05-17T17:52:04Z
- Model: afl-disp-20260517-174830
- Sample count: 1041
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.14%, brier 0.244915, logloss 0.693751, clv+ 28.15%

## Confidence Buckets
- high_0.65_plus: n=140, hit=68.57%
- low: n=900, hit=53.0%
- mid_0.57_0.65: n=1, hit=100.0%

## Edge Buckets
- edge_5_8: n=130, hit=53.85%
- edge_8_plus: n=142, hit=68.31%
- edge_under_5: n=769, hit=52.93%

## Top Loss Types
- Under->Over: 438
- Over->Under: 29
