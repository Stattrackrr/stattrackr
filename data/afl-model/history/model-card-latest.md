# AFL Disposals Model Card

- Generated: 2026-05-07T18:22:35Z
- Model: afl-disp-20260507-181851
- Sample count: 759
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.65%, brier 0.241646, logloss 0.676042, clv+ 28.33%

## Confidence Buckets
- high_0.65_plus: n=102, hit=70.59%
- low: n=562, hit=53.2%
- mid_0.57_0.65: n=95, hit=62.11%

## Edge Buckets
- edge_5_8: n=115, hit=54.78%
- edge_8_plus: n=190, hit=66.32%
- edge_under_5: n=454, hit=53.08%

## Top Loss Types
- Under->Over: 316
- Over->Under: 13
