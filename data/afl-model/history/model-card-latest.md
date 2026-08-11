# AFL Disposals Model Card

- Generated: 2026-08-11T11:42:33Z
- Model: afl-disp-20260811-114133
- Sample count: 715
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.75%, brier 0.275568, logloss 0.778601, clv+ 16.78%

## Confidence Buckets
- high_0.65_plus: n=246, hit=52.85%
- low: n=251, hit=52.19%
- mid_0.57_0.65: n=218, hit=50.0%

## Edge Buckets
- edge_5_8: n=103, hit=53.4%
- edge_8_plus: n=430, hit=51.86%
- edge_under_5: n=182, hit=50.55%

## Top Loss Types
- Under->Over: 228
- Over->Under: 117
