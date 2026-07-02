# AFL Disposals Model Card

- Generated: 2026-07-02T19:04:41Z
- Model: afl-disp-20260702-182912
- Sample count: 1448
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.42%, brier 0.265529, logloss 0.742004, clv+ 20.37%

## Confidence Buckets
- high_0.65_plus: n=473, hit=54.76%
- low: n=504, hit=52.58%
- mid_0.57_0.65: n=471, hit=49.89%

## Edge Buckets
- edge_5_8: n=183, hit=50.27%
- edge_8_plus: n=886, hit=52.93%
- edge_under_5: n=379, hit=52.24%

## Top Loss Types
- Under->Over: 447
- Over->Under: 242
