# AFL Disposals Model Card

- Generated: 2026-05-03T11:44:33Z
- Model: afl-disp-20260503-114041
- Sample count: 718
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.43%, brier 0.245188, logloss 0.698782, clv+ 28.27%

## Confidence Buckets
- high_0.65_plus: n=50, hit=66.0%
- low: n=555, hit=53.51%
- mid_0.57_0.65: n=113, hit=60.18%

## Edge Buckets
- edge_5_8: n=238, hit=47.9%
- edge_8_plus: n=176, hit=68.18%
- edge_under_5: n=304, hit=53.95%

## Top Loss Types
- Under->Over: 286
- Over->Under: 34
