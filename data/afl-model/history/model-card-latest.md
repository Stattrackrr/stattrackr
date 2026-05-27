# AFL Disposals Model Card

- Generated: 2026-05-27T14:28:49Z
- Model: afl-disp-20260527-142607
- Sample count: 1233
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.39%, brier 0.245044, logloss 0.682847, clv+ 27.01%

## Confidence Buckets
- high_0.65_plus: n=49, hit=75.51%
- low: n=1006, hit=53.98%
- mid_0.57_0.65: n=178, hit=57.87%

## Edge Buckets
- edge_5_8: n=287, hit=52.61%
- edge_8_plus: n=118, hit=67.8%
- edge_under_5: n=828, hit=54.59%

## Top Loss Types
- Under->Over: 493
- Over->Under: 57
