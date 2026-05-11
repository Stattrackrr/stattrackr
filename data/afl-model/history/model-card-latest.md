# AFL Disposals Model Card

- Generated: 2026-05-11T13:47:47Z
- Model: afl-disp-20260511-134640
- Sample count: 900
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.22%, brier 0.239853, logloss 0.670994, clv+ 29.56%

## Confidence Buckets
- high_0.65_plus: n=113, hit=74.34%
- low: n=611, hit=51.72%
- mid_0.57_0.65: n=176, hit=60.23%

## Edge Buckets
- edge_5_8: n=33, hit=72.73%
- edge_8_plus: n=264, hit=64.39%
- edge_under_5: n=603, hit=51.74%

## Top Loss Types
- Under->Over: 280
- Over->Under: 114
