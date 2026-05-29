# AFL Disposals Model Card

- Generated: 2026-05-29T14:03:29Z
- Model: afl-disp-20260529-135820
- Sample count: 1278
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.01%, brier 0.245039, logloss 0.691643, clv+ 25.82%

## Confidence Buckets
- high_0.65_plus: n=73, hit=72.6%
- low: n=951, hit=52.47%
- mid_0.57_0.65: n=254, hit=59.45%

## Edge Buckets
- edge_5_8: n=63, hit=47.62%
- edge_8_plus: n=311, hit=62.38%
- edge_under_5: n=904, hit=52.99%

## Top Loss Types
- Under->Over: 461
- Over->Under: 114
