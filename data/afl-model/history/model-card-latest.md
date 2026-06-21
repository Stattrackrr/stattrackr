# AFL Disposals Model Card

- Generated: 2026-06-21T13:07:30Z
- Model: afl-disp-20260621-130451
- Sample count: 1627
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.9%, brier 0.247175, logloss 0.694166, clv+ 21.82%

## Confidence Buckets
- high_0.65_plus: n=50, hit=70.0%
- low: n=1364, hit=52.42%
- mid_0.57_0.65: n=213, hit=59.62%

## Edge Buckets
- edge_5_8: n=167, hit=52.69%
- edge_8_plus: n=254, hit=61.42%
- edge_under_5: n=1206, hit=52.49%

## Top Loss Types
- Under->Over: 686
- Over->Under: 64
