# AFL Disposals Model Card

- Generated: 2026-08-03T18:34:11Z
- Model: afl-disp-20260803-183220
- Sample count: 811
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.01%, brier 0.264103, logloss 0.738534, clv+ 18.13%

## Confidence Buckets
- high_0.65_plus: n=242, hit=53.72%
- low: n=286, hit=53.85%
- mid_0.57_0.65: n=283, hit=54.42%

## Edge Buckets
- edge_5_8: n=122, hit=53.28%
- edge_8_plus: n=491, hit=54.18%
- edge_under_5: n=198, hit=54.04%

## Top Loss Types
- Under->Over: 238
- Over->Under: 135
