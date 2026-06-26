# AFL Disposals Model Card

- Generated: 2026-06-26T13:12:45Z
- Model: afl-disp-20260626-130940
- Sample count: 1560
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.97%, brier 0.247197, logloss 0.694039, clv+ 21.15%

## Confidence Buckets
- high_0.65_plus: n=71, hit=64.79%
- low: n=1395, hit=52.83%
- mid_0.57_0.65: n=94, hit=62.77%

## Edge Buckets
- edge_5_8: n=144, hit=56.25%
- edge_8_plus: n=160, hit=63.12%
- edge_under_5: n=1256, hit=52.55%

## Top Loss Types
- Under->Over: 623
- Over->Under: 95
