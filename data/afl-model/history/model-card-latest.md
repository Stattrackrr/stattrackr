# AFL Disposals Model Card

- Generated: 2026-04-13T17:54:49Z
- Model: afl-disp-20260413-175319
- Sample count: 225
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 59.56%, brier 0.234785, logloss 0.65815, clv+ 31.11%

## Confidence Buckets
- high_0.65_plus: n=39, hit=71.79%
- low: n=83, hit=53.01%
- mid_0.57_0.65: n=103, hit=60.19%

## Edge Buckets
- edge_5_8: n=79, hit=56.96%
- edge_8_plus: n=140, hit=62.14%
- edge_under_5: n=6, hit=33.33%

## Top Loss Types
- Under->Over: 91
