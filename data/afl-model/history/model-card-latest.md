# AFL Disposals Model Card

- Generated: 2026-08-15T17:06:25Z
- Model: afl-disp-20260815-170431
- Sample count: 595
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.44%, brier 0.266048, logloss 0.745089, clv+ 14.79%

## Confidence Buckets
- high_0.65_plus: n=179, hit=54.19%
- low: n=219, hit=52.05%
- mid_0.57_0.65: n=197, hit=51.27%

## Edge Buckets
- edge_5_8: n=94, hit=44.68%
- edge_8_plus: n=346, hit=53.18%
- edge_under_5: n=155, hit=55.48%

## Top Loss Types
- Under->Over: 189
- Over->Under: 94
