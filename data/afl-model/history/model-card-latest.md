# AFL Disposals Model Card

- Generated: 2026-05-21T18:40:27Z
- Model: afl-disp-20260521-183602
- Sample count: 1064
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.08%, brier 0.244917, logloss 0.682796, clv+ 27.63%

## Confidence Buckets
- high_0.65_plus: n=202, hit=65.35%
- low: n=861, hit=52.73%
- mid_0.57_0.65: n=1, hit=0.0%

## Edge Buckets
- edge_5_8: n=124, hit=50.81%
- edge_8_plus: n=203, hit=65.02%
- edge_under_5: n=737, hit=53.05%

## Top Loss Types
- Under->Over: 400
- Over->Under: 78
