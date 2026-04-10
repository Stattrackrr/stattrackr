# AFL Disposals Model Card

- Generated: 2026-04-09T17:57:27Z
- Model: afl-disp-20260409-175237
- Sample count: 117
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.14%, brier 0.266974, logloss 0.732979, clv+ 19.66%

## Confidence Buckets
- high_0.65_plus: n=38, hit=47.37%
- low: n=33, hit=48.48%
- mid_0.57_0.65: n=46, hit=58.7%

## Edge Buckets
- edge_5_8: n=15, hit=46.67%
- edge_8_plus: n=77, hit=54.55%
- edge_under_5: n=25, hit=48.0%

## Top Loss Types
- Under->Over: 37
- Over->Under: 19
