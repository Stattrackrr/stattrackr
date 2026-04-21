# AFL Disposals Model Card

- Generated: 2026-04-20T17:53:54Z
- Model: afl-disp-20260420-175139
- Sample count: 390
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.38%, brier 0.239848, logloss 0.670405, clv+ 24.62%

## Confidence Buckets
- high_0.65_plus: n=42, hit=71.43%
- low: n=301, hit=50.83%
- mid_0.57_0.65: n=47, hit=70.21%

## Edge Buckets
- edge_5_8: n=29, hit=51.72%
- edge_8_plus: n=89, hit=70.79%
- edge_under_5: n=272, hit=50.74%

## Top Loss Types
- Under->Over: 171
- Over->Under: 3
