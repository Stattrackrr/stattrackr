# AFL Disposals Model Card

- Generated: 2026-04-23T12:02:01Z
- Model: afl-disp-20260423-115902
- Sample count: 390
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.15%, brier 0.237984, logloss 0.666133, clv+ 29.74%

## Confidence Buckets
- high_0.65_plus: n=39, hit=79.49%
- low: n=287, hit=51.57%
- mid_0.57_0.65: n=64, hit=62.5%

## Edge Buckets
- edge_5_8: n=78, hit=50.0%
- edge_8_plus: n=93, hit=70.97%
- edge_under_5: n=219, hit=52.05%

## Top Loss Types
- Over->Under: 105
- Under->Over: 66
