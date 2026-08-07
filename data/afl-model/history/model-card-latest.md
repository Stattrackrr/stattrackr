# AFL Disposals Model Card

- Generated: 2026-08-07T11:44:37Z
- Model: afl-disp-20260807-114333
- Sample count: 764
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.4%, brier 0.264763, logloss 0.743211, clv+ 14.92%

## Confidence Buckets
- high_0.65_plus: n=232, hit=55.6%
- low: n=278, hit=53.6%
- mid_0.57_0.65: n=254, hit=51.18%

## Edge Buckets
- edge_5_8: n=118, hit=52.54%
- edge_8_plus: n=457, hit=54.27%
- edge_under_5: n=189, hit=51.85%

## Top Loss Types
- Under->Over: 244
- Over->Under: 112
