# AFL Disposals Model Card

- Generated: 2026-07-07T13:29:29Z
- Model: afl-disp-20260707-132118
- Sample count: 1377
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.81%, brier 0.266107, logloss 0.741482, clv+ 20.12%

## Confidence Buckets
- high_0.65_plus: n=470, hit=52.98%
- low: n=472, hit=54.03%
- mid_0.57_0.65: n=435, hit=54.48%

## Edge Buckets
- edge_5_8: n=185, hit=55.68%
- edge_8_plus: n=842, hit=53.56%
- edge_under_5: n=350, hit=53.43%

## Top Loss Types
- Under->Over: 434
- Over->Under: 202
