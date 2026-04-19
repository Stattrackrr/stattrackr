# AFL Disposals Model Card

- Generated: 2026-04-19T11:36:03Z
- Model: afl-disp-20260419-113356
- Sample count: 390
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.13%, brier 0.244822, logloss 0.739898, clv+ 24.1%

## Confidence Buckets
- high_0.65_plus: n=82, hit=69.51%
- low: n=219, hit=51.14%
- mid_0.57_0.65: n=89, hit=51.69%

## Edge Buckets
- edge_5_8: n=46, hit=65.22%
- edge_8_plus: n=157, hit=59.24%
- edge_under_5: n=187, hit=49.2%

## Top Loss Types
- Under->Over: 167
- Over->Under: 8
