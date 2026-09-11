# AFL Disposals Model Card

- Generated: 2026-09-11T19:33:00Z
- Model: afl-disp-20260911-193225
- Sample count: 184
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 45.65%, brier 0.296448, logloss 0.824167, clv+ 13.59%

## Confidence Buckets
- high_0.65_plus: n=62, hit=41.94%
- low: n=47, hit=40.43%
- mid_0.57_0.65: n=75, hit=52.0%

## Edge Buckets
- edge_5_8: n=19, hit=73.68%
- edge_8_plus: n=127, hit=45.67%
- edge_under_5: n=38, hit=31.58%

## Top Loss Types
- Under->Over: 70
- Over->Under: 30
