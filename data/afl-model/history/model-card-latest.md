# AFL Disposals Model Card

- Generated: 2026-05-14T12:27:39Z
- Model: afl-disp-20260514-122511
- Sample count: 911
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.21%, brier 0.243265, logloss 0.678909, clv+ 30.3%

## Confidence Buckets
- high_0.65_plus: n=134, hit=68.66%
- low: n=777, hit=52.9%

## Edge Buckets
- edge_5_8: n=224, hit=48.66%
- edge_8_plus: n=166, hit=68.67%
- edge_under_5: n=521, hit=53.74%

## Top Loss Types
- Under->Over: 242
- Over->Under: 166
