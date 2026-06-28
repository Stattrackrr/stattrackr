# AFL Disposals Model Card

- Generated: 2026-06-28T18:02:16Z
- Model: afl-disp-20260628-175854
- Sample count: 1607
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.27%, brier 0.264165, logloss 0.738115, clv+ 20.54%

## Confidence Buckets
- high_0.65_plus: n=520, hit=54.62%
- low: n=563, hit=52.58%
- mid_0.57_0.65: n=524, hit=52.67%

## Edge Buckets
- edge_5_8: n=220, hit=52.73%
- edge_8_plus: n=977, hit=53.33%
- edge_under_5: n=410, hit=53.41%

## Top Loss Types
- Under->Over: 496
- Over->Under: 255
