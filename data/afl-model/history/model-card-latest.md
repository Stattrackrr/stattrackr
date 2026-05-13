# AFL Disposals Model Card

- Generated: 2026-05-13T13:11:23Z
- Model: afl-disp-20260513-130933
- Sample count: 900
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.67%, brier 0.242339, logloss 0.676938, clv+ 27.44%

## Confidence Buckets
- high_0.65_plus: n=218, hit=66.97%
- low: n=634, hit=51.58%
- mid_0.57_0.65: n=48, hit=58.33%

## Edge Buckets
- edge_5_8: n=11, hit=54.55%
- edge_8_plus: n=258, hit=65.5%
- edge_under_5: n=631, hit=51.66%

## Top Loss Types
- Under->Over: 343
- Over->Under: 56
