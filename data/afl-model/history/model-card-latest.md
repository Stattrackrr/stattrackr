# AFL Disposals Model Card

- Generated: 2026-06-26T18:30:00Z
- Model: afl-disp-20260626-182600
- Sample count: 1507
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.15%, brier 0.247055, logloss 0.686719, clv+ 20.64%

## Confidence Buckets
- high_0.65_plus: n=30, hit=76.67%
- low: n=1460, hit=53.63%
- mid_0.57_0.65: n=17, hit=58.82%

## Edge Buckets
- edge_5_8: n=127, hit=55.12%
- edge_8_plus: n=47, hit=70.21%
- edge_under_5: n=1333, hit=53.49%

## Top Loss Types
- Under->Over: 505
- Over->Under: 186
