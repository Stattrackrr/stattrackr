# AFL Disposals Model Card

- Generated: 2026-06-18T19:01:45Z
- Model: afl-disp-20260618-185721
- Sample count: 1616
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.83%, brier 0.246814, logloss 0.693813, clv+ 21.6%

## Confidence Buckets
- high_0.65_plus: n=37, hit=67.57%
- low: n=1423, hit=53.48%
- mid_0.57_0.65: n=156, hit=64.1%

## Edge Buckets
- edge_5_8: n=834, hit=52.64%
- edge_8_plus: n=211, hit=64.93%
- edge_under_5: n=571, hit=54.29%

## Top Loss Types
- Under->Over: 522
- Over->Under: 208
