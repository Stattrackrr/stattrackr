# AFL Disposals Model Card

- Generated: 2026-09-10T14:50:06Z
- Model: afl-disp-20260910-144906
- Sample count: 250
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.8%, brier 0.290933, logloss 0.826009, clv+ 12.4%

## Confidence Buckets
- high_0.65_plus: n=96, hit=45.83%
- low: n=80, hit=53.75%
- mid_0.57_0.65: n=74, hit=54.05%

## Edge Buckets
- edge_5_8: n=39, hit=48.72%
- edge_8_plus: n=157, hit=49.68%
- edge_under_5: n=54, hit=55.56%

## Top Loss Types
- Under->Over: 96
- Over->Under: 27
