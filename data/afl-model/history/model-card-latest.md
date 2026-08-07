# AFL Disposals Model Card

- Generated: 2026-08-07T17:33:18Z
- Model: afl-disp-20260807-173117
- Sample count: 764
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.32%, brier 0.263266, logloss 0.737385, clv+ 15.18%

## Confidence Buckets
- high_0.65_plus: n=224, hit=54.46%
- low: n=301, hit=53.49%
- mid_0.57_0.65: n=239, hit=55.23%

## Edge Buckets
- edge_5_8: n=119, hit=52.1%
- edge_8_plus: n=436, hit=54.59%
- edge_under_5: n=209, hit=55.02%

## Top Loss Types
- Under->Over: 226
- Over->Under: 123
