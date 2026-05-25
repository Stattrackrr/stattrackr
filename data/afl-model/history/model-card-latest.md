# AFL Disposals Model Card

- Generated: 2026-05-25T14:06:39Z
- Model: afl-disp-20260525-135919
- Sample count: 1233
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.99%, brier 0.244719, logloss 0.682104, clv+ 29.2%

## Confidence Buckets
- high_0.65_plus: n=93, hit=69.89%
- low: n=1091, hit=53.71%
- mid_0.57_0.65: n=49, hit=55.1%

## Edge Buckets
- edge_5_8: n=486, hit=54.73%
- edge_8_plus: n=216, hit=62.5%
- edge_under_5: n=531, hit=52.17%

## Top Loss Types
- Under->Over: 324
- Over->Under: 231
