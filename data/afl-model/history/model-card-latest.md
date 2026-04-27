# AFL Disposals Model Card

- Generated: 2026-04-27T12:21:49Z
- Model: afl-disp-20260427-122051
- Sample count: 549
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 56.1%, brier 0.24085, logloss 0.673262, clv+ 27.5%

## Confidence Buckets
- high_0.65_plus: n=63, hit=69.84%
- low: n=399, hit=52.38%
- mid_0.57_0.65: n=87, hit=63.22%

## Edge Buckets
- edge_5_8: n=47, hit=57.45%
- edge_8_plus: n=154, hit=66.23%
- edge_under_5: n=348, hit=51.44%

## Top Loss Types
- Under->Over: 217
- Over->Under: 24
