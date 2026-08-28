# AFL Disposals Model Card

- Generated: 2026-08-28T21:22:07Z
- Model: afl-disp-20260828-212111
- Sample count: 404
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.99%, brier 0.279941, logloss 0.789483, clv+ 14.11%

## Confidence Buckets
- high_0.65_plus: n=142, hit=50.0%
- low: n=138, hit=50.0%
- mid_0.57_0.65: n=124, hit=53.23%

## Edge Buckets
- edge_5_8: n=58, hit=51.72%
- edge_8_plus: n=247, hit=51.42%
- edge_under_5: n=99, hit=49.49%

## Top Loss Types
- Under->Over: 141
- Over->Under: 57
