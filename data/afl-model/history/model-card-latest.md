# AFL Disposals Model Card

- Generated: 2026-08-22T17:05:37Z
- Model: afl-disp-20260822-170406
- Sample count: 491
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.55%, brier 0.26591, logloss 0.747695, clv+ 18.33%

## Confidence Buckets
- high_0.65_plus: n=160, hit=58.13%
- low: n=167, hit=52.1%
- mid_0.57_0.65: n=164, hit=47.56%

## Edge Buckets
- edge_5_8: n=61, hit=44.26%
- edge_8_plus: n=307, hit=53.09%
- edge_under_5: n=123, hit=55.28%

## Top Loss Types
- Under->Over: 158
- Over->Under: 75
