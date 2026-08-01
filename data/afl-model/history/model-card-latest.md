# AFL Disposals Model Card

- Generated: 2026-08-01T17:45:29Z
- Model: afl-disp-20260801-174353
- Sample count: 890
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.26%, brier 0.263088, logloss 0.736257, clv+ 16.74%

## Confidence Buckets
- high_0.65_plus: n=254, hit=53.15%
- low: n=349, hit=49.86%
- mid_0.57_0.65: n=287, hit=57.49%

## Edge Buckets
- edge_5_8: n=146, hit=51.37%
- edge_8_plus: n=497, hit=54.73%
- edge_under_5: n=247, hit=51.42%

## Top Loss Types
- Under->Over: 261
- Over->Under: 155
