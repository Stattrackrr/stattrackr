# AFL Disposals Model Card

- Generated: 2026-08-10T17:35:17Z
- Model: afl-disp-20260810-173257
- Sample count: 715
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.17%, brier 0.265364, logloss 0.739975, clv+ 16.08%

## Confidence Buckets
- high_0.65_plus: n=229, hit=57.21%
- low: n=254, hit=50.79%
- mid_0.57_0.65: n=232, hit=48.71%

## Edge Buckets
- edge_5_8: n=92, hit=51.09%
- edge_8_plus: n=436, hit=52.06%
- edge_under_5: n=187, hit=52.94%

## Top Loss Types
- Under->Over: 220
- Over->Under: 122
