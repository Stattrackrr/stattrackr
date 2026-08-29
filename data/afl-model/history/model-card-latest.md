# AFL Disposals Model Card

- Generated: 2026-08-29T00:56:56Z
- Model: afl-disp-20260829-005538
- Sample count: 404
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 49.26%, brier 0.27145, logloss 0.75336, clv+ 16.58%

## Confidence Buckets
- high_0.65_plus: n=127, hit=52.76%
- low: n=133, hit=46.62%
- mid_0.57_0.65: n=144, hit=48.61%

## Edge Buckets
- edge_5_8: n=61, hit=63.93%
- edge_8_plus: n=241, hit=49.38%
- edge_under_5: n=102, hit=40.2%

## Top Loss Types
- Under->Over: 140
- Over->Under: 65
