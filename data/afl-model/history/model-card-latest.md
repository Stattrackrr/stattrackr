# AFL Disposals Model Card

- Generated: 2026-07-09T13:57:21Z
- Model: afl-disp-20260709-135123
- Sample count: 1255
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.68%, brier 0.275785, logloss 0.771869, clv+ 19.84%

## Confidence Buckets
- high_0.65_plus: n=441, hit=51.7%
- low: n=431, hit=48.72%
- mid_0.57_0.65: n=383, hit=51.7%

## Edge Buckets
- edge_5_8: n=169, hit=53.85%
- edge_8_plus: n=767, hit=51.11%
- edge_under_5: n=319, hit=47.96%

## Top Loss Types
- Under->Over: 406
- Over->Under: 213
