# AFL Disposals Model Card

- Generated: 2026-08-20T17:17:35Z
- Model: afl-disp-20260820-171600
- Sample count: 576
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.78%, brier 0.267665, logloss 0.748203, clv+ 15.45%

## Confidence Buckets
- high_0.65_plus: n=170, hit=52.94%
- low: n=208, hit=52.88%
- mid_0.57_0.65: n=198, hit=52.53%

## Edge Buckets
- edge_5_8: n=100, hit=52.0%
- edge_8_plus: n=335, hit=51.94%
- edge_under_5: n=141, hit=55.32%

## Top Loss Types
- Under->Over: 182
- Over->Under: 90
