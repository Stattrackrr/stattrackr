# AFL Disposals Model Card

- Generated: 2026-09-03T19:42:06Z
- Model: afl-disp-20260903-194044
- Sample count: 290
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 48.62%, brier 0.276891, logloss 0.770011, clv+ 14.83%

## Confidence Buckets
- high_0.65_plus: n=91, hit=50.55%
- low: n=100, hit=46.0%
- mid_0.57_0.65: n=99, hit=49.49%

## Edge Buckets
- edge_5_8: n=48, hit=58.33%
- edge_8_plus: n=172, hit=48.26%
- edge_under_5: n=70, hit=42.86%

## Top Loss Types
- Under->Over: 104
- Over->Under: 45
