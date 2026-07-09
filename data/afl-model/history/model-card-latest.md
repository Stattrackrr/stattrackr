# AFL Disposals Model Card

- Generated: 2026-07-09T18:10:41Z
- Model: afl-disp-20260709-180502
- Sample count: 1255
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 52.99%, brier 0.267522, logloss 0.744764, clv+ 17.93%

## Confidence Buckets
- high_0.65_plus: n=414, hit=52.17%
- low: n=446, hit=52.91%
- mid_0.57_0.65: n=395, hit=53.92%

## Edge Buckets
- edge_5_8: n=178, hit=52.25%
- edge_8_plus: n=741, hit=53.98%
- edge_under_5: n=336, hit=51.19%

## Top Loss Types
- Under->Over: 411
- Over->Under: 179
