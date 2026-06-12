# AFL Disposals Model Card

- Generated: 2026-06-12T18:45:12Z
- Model: afl-disp-20260612-183937
- Sample count: 1534
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.5%, brier 0.246989, logloss 0.686863, clv+ 23.08%

## Confidence Buckets
- high_0.65_plus: n=20, hit=70.0%
- low: n=1317, hit=53.3%
- mid_0.57_0.65: n=197, hit=60.91%

## Edge Buckets
- edge_5_8: n=264, hit=50.38%
- edge_8_plus: n=209, hit=61.72%
- edge_under_5: n=1061, hit=54.1%

## Top Loss Types
- Under->Over: 582
- Over->Under: 116
