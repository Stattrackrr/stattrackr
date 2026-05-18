# AFL Disposals Model Card

- Generated: 2026-05-18T14:31:37Z
- Model: afl-disp-20260518-143004
- Sample count: 1041
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.66%, brier 0.245418, logloss 0.683564, clv+ 28.72%

## Confidence Buckets
- high_0.65_plus: n=123, hit=62.6%
- low: n=641, hit=50.86%
- mid_0.57_0.65: n=277, hit=59.93%

## Edge Buckets
- edge_5_8: n=67, hit=64.18%
- edge_8_plus: n=385, hit=59.74%
- edge_under_5: n=589, hit=50.25%

## Top Loss Types
- Under->Over: 443
- Over->Under: 29
