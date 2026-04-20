# AFL Disposals Model Card

- Generated: 2026-04-20T12:03:50Z
- Model: afl-disp-20260420-120242
- Sample count: 390
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 57.18%, brier 0.239141, logloss 0.698987, clv+ 27.69%

## Confidence Buckets
- high_0.65_plus: n=62, hit=75.81%
- low: n=303, hit=53.14%
- mid_0.57_0.65: n=25, hit=60.0%

## Edge Buckets
- edge_5_8: n=15, hit=80.0%
- edge_8_plus: n=86, hit=70.93%
- edge_under_5: n=289, hit=51.9%

## Top Loss Types
- Under->Over: 90
- Over->Under: 77
