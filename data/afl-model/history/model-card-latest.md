# AFL Disposals Model Card

- Generated: 2026-07-21T12:26:15Z
- Model: afl-disp-20260721-122351
- Sample count: 1097
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.42%, brier 0.268912, logloss 0.749862, clv+ 17.5%

## Confidence Buckets
- high_0.65_plus: n=366, hit=50.27%
- low: n=372, hit=53.49%
- mid_0.57_0.65: n=359, hit=56.55%

## Edge Buckets
- edge_5_8: n=139, hit=59.71%
- edge_8_plus: n=680, hit=52.5%
- edge_under_5: n=278, hit=52.52%

## Top Loss Types
- Under->Over: 350
- Over->Under: 161
