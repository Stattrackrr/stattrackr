# AFL Disposals Model Card

- Generated: 2026-04-06T19:03:12Z
- Model: afl-disp-20260406-190304
- Sample count: 100
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 52.0%, brier 0.264826, logloss 0.725616, clv+ 24.0%

## Confidence Buckets
- high_0.65_plus: n=36, hit=55.56%
- low: n=28, hit=53.57%
- mid_0.57_0.65: n=36, hit=47.22%

## Edge Buckets
- edge_5_8: n=16, hit=56.25%
- edge_8_plus: n=63, hit=50.79%
- edge_under_5: n=21, hit=52.38%

## Top Loss Types
- Under->Over: 31
- Over->Under: 17
