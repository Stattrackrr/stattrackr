# AFL Disposals Model Card

- Generated: 2026-09-11T14:52:17Z
- Model: afl-disp-20260911-145147
- Sample count: 184
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.17%, brier 0.288601, logloss 0.825903, clv+ 14.67%

## Confidence Buckets
- high_0.65_plus: n=70, hit=45.71%
- low: n=58, hit=53.45%
- mid_0.57_0.65: n=56, hit=58.93%

## Edge Buckets
- edge_5_8: n=29, hit=51.72%
- edge_8_plus: n=114, hit=51.75%
- edge_under_5: n=41, hit=53.66%

## Top Loss Types
- Under->Over: 68
- Over->Under: 20
