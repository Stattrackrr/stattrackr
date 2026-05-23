# AFL Disposals Model Card

- Generated: 2026-05-23T12:04:35Z
- Model: afl-disp-20260523-115854
- Sample count: 1167
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.84%, brier 0.243348, logloss 0.679132, clv+ 27.16%

## Confidence Buckets
- high_0.65_plus: n=132, hit=72.73%
- low: n=1035, hit=52.56%

## Edge Buckets
- edge_5_8: n=170, hit=51.76%
- edge_8_plus: n=158, hit=70.89%
- edge_under_5: n=839, hit=52.44%

## Top Loss Types
- Under->Over: 487
- Over->Under: 40
