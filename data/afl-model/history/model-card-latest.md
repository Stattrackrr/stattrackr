# AFL Disposals Model Card

- Generated: 2026-09-15T15:27:37Z
- Model: afl-disp-20260915-152707
- Sample count: 145
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.34%, brier 0.29153, logloss 0.800995, clv+ 14.48%

## Confidence Buckets
- high_0.65_plus: n=56, hit=46.43%
- low: n=51, hit=52.94%
- mid_0.57_0.65: n=38, hit=52.63%

## Edge Buckets
- edge_5_8: n=21, hit=33.33%
- edge_8_plus: n=90, hit=50.0%
- edge_under_5: n=34, hit=61.76%

## Top Loss Types
- Under->Over: 53
- Over->Under: 19
