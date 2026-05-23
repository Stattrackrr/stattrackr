# AFL Disposals Model Card

- Generated: 2026-05-23T17:54:08Z
- Model: afl-disp-20260523-175011
- Sample count: 1186
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.14%, brier 0.245795, logloss 0.684662, clv+ 26.48%

## Confidence Buckets
- high_0.65_plus: n=64, hit=70.31%
- low: n=982, hit=53.46%
- mid_0.57_0.65: n=140, hit=60.0%

## Edge Buckets
- edge_5_8: n=175, hit=53.71%
- edge_8_plus: n=214, hit=62.62%
- edge_under_5: n=797, hit=53.45%

## Top Loss Types
- Under->Over: 485
- Over->Under: 47
