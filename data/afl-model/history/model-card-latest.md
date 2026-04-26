# AFL Disposals Model Card

- Generated: 2026-04-26T11:40:47Z
- Model: afl-disp-20260426-113813
- Sample count: 549
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.19%, brier 0.241354, logloss 0.674196, clv+ 27.32%

## Confidence Buckets
- high_0.65_plus: n=82, hit=71.95%
- low: n=467, hit=52.25%

## Edge Buckets
- edge_5_8: n=144, hit=55.56%
- edge_8_plus: n=86, hit=72.09%
- edge_under_5: n=319, hit=50.47%

## Top Loss Types
- Under->Over: 196
- Over->Under: 50
