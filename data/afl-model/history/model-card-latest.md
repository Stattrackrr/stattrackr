# AFL Disposals Model Card

- Generated: 2026-04-24T17:49:13Z
- Model: afl-disp-20260424-174616
- Sample count: 421
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.06%, brier 0.241834, logloss 0.675732, clv+ 24.7%

## Confidence Buckets
- high_0.65_plus: n=35, hit=71.43%
- low: n=187, hit=50.27%
- mid_0.57_0.65: n=199, hit=58.79%

## Edge Buckets
- edge_5_8: n=118, hit=53.39%
- edge_8_plus: n=121, hit=65.29%
- edge_under_5: n=182, hit=51.65%

## Top Loss Types
- Under->Over: 149
- Over->Under: 36
