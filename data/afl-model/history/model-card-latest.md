# AFL Disposals Model Card

- Generated: 2026-05-09T11:56:14Z
- Model: afl-disp-20260509-114850
- Sample count: 842
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 56.53%, brier 0.241702, logloss 0.689654, clv+ 29.33%

## Confidence Buckets
- high_0.65_plus: n=212, hit=67.45%
- low: n=630, hit=52.86%

## Edge Buckets
- edge_5_8: n=174, hit=50.0%
- edge_8_plus: n=219, hit=68.04%
- edge_under_5: n=449, hit=53.45%

## Top Loss Types
- Under->Over: 264
- Over->Under: 102
