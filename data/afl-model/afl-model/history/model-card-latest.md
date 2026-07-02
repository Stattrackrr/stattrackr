# AFL Disposals Model Card

- Generated: 2026-07-02T13:24:47Z
- Model: afl-disp-20260702-125821
- Sample count: 1502
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.66%, brier 0.26676, logloss 0.746521, clv+ 20.97%

## Confidence Buckets
- high_0.65_plus: n=539, hit=52.5%
- low: n=506, hit=52.37%
- mid_0.57_0.65: n=457, hit=56.46%

## Edge Buckets
- edge_5_8: n=185, hit=52.43%
- edge_8_plus: n=934, hit=53.85%
- edge_under_5: n=383, hit=53.79%

## Top Loss Types
- Under->Over: 472
- Over->Under: 224
