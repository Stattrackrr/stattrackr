# AFL Disposals Model Card

- Generated: 2026-05-14T18:35:09Z
- Model: afl-disp-20260514-183147
- Sample count: 911
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.21%, brier 0.243417, logloss 0.679628, clv+ 26.89%

## Confidence Buckets
- high_0.65_plus: n=120, hit=70.0%
- low: n=713, hit=52.31%
- mid_0.57_0.65: n=78, hit=58.97%

## Edge Buckets
- edge_5_8: n=46, hit=60.87%
- edge_8_plus: n=177, hit=66.1%
- edge_under_5: n=688, hit=52.03%

## Top Loss Types
- Under->Over: 381
- Over->Under: 27
