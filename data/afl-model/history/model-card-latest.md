# AFL Disposals Model Card

- Generated: 2026-04-16T12:01:07Z
- Model: afl-disp-20260416-115820
- Sample count: 225
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 59.56%, brier 0.222249, logloss 0.629819, clv+ 31.11%

## Confidence Buckets
- high_0.65_plus: n=35, hit=88.57%
- low: n=136, hit=50.74%
- mid_0.57_0.65: n=54, hit=62.96%

## Edge Buckets
- edge_5_8: n=3, hit=100.0%
- edge_8_plus: n=89, hit=73.03%
- edge_under_5: n=133, hit=49.62%

## Top Loss Types
- Under->Over: 91
