# AFL Disposals Model Card

- Generated: 2026-09-04T19:22:39Z
- Model: afl-disp-20260904-192119
- Sample count: 290
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 46.9%, brier 0.28431, logloss 0.787096, clv+ 16.21%

## Confidence Buckets
- high_0.65_plus: n=102, hit=49.02%
- low: n=88, hit=45.45%
- mid_0.57_0.65: n=100, hit=46.0%

## Edge Buckets
- edge_5_8: n=43, hit=46.51%
- edge_8_plus: n=184, hit=47.28%
- edge_under_5: n=63, hit=46.03%

## Top Loss Types
- Under->Over: 109
- Over->Under: 45
