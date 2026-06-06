# AFL Disposals Model Card

- Generated: 2026-06-06T18:01:04Z
- Model: afl-disp-20260606-175710
- Sample count: 1506
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.91%, brier 0.245902, logloss 0.684786, clv+ 25.23%

## Confidence Buckets
- high_0.65_plus: n=41, hit=65.85%
- low: n=1286, hit=53.34%
- mid_0.57_0.65: n=179, hit=63.69%

## Edge Buckets
- edge_5_8: n=145, hit=52.41%
- edge_8_plus: n=218, hit=64.22%
- edge_under_5: n=1143, hit=53.46%

## Top Loss Types
- Under->Over: 623
- Over->Under: 56
