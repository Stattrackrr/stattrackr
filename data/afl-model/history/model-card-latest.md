# AFL Disposals Model Card

- Generated: 2026-04-13T12:03:18Z
- Model: afl-disp-20260413-120159
- Sample count: 225
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 60.44%, brier 0.22585, logloss 0.637865, clv+ 31.11%

## Confidence Buckets
- high_0.65_plus: n=52, hit=78.85%
- low: n=118, hit=52.54%
- mid_0.57_0.65: n=55, hit=60.0%

## Edge Buckets
- edge_5_8: n=17, hit=41.18%
- edge_8_plus: n=102, hit=70.59%
- edge_under_5: n=106, hit=53.77%

## Top Loss Types
- Under->Over: 84
- Over->Under: 5
