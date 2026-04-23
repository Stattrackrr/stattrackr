# AFL Disposals Model Card

- Generated: 2026-04-23T18:13:21Z
- Model: afl-disp-20260423-181104
- Sample count: 406
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.91%, brier 0.2405, logloss 0.671957, clv+ 24.88%

## Confidence Buckets
- high_0.65_plus: n=45, hit=73.33%
- low: n=361, hit=53.74%

## Edge Buckets
- edge_5_8: n=155, hit=55.48%
- edge_8_plus: n=61, hit=75.41%
- edge_under_5: n=190, hit=50.0%

## Top Loss Types
- Under->Over: 179
