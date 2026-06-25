# AFL Disposals Model Card

- Generated: 2026-06-25T18:45:49Z
- Model: afl-disp-20260625-184422
- Sample count: 1595
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.42%, brier 0.24702, logloss 0.694052, clv+ 20.63%

## Confidence Buckets
- high_0.65_plus: n=24, hit=66.67%
- low: n=1466, hit=53.41%
- mid_0.57_0.65: n=105, hit=65.71%

## Edge Buckets
- edge_5_8: n=140, hit=53.57%
- edge_8_plus: n=129, hit=65.89%
- edge_under_5: n=1326, hit=53.39%

## Top Loss Types
- Under->Over: 605
- Over->Under: 122
