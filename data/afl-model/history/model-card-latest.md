# AFL Disposals Model Card

- Generated: 2026-04-09T15:41:03Z
- Model: afl-disp-20260409-154001
- Sample count: 117
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 49.57%, brier 0.26019, logloss 0.714761, clv+ 24.79%

## Confidence Buckets
- high_0.65_plus: n=31, hit=58.06%
- low: n=41, hit=46.34%
- mid_0.57_0.65: n=45, hit=46.67%

## Edge Buckets
- edge_5_8: n=13, hit=69.23%
- edge_8_plus: n=70, hit=48.57%
- edge_under_5: n=34, hit=44.12%

## Top Loss Types
- Under->Over: 32
- Over->Under: 27
