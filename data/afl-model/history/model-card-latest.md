# AFL Disposals Model Card

- Generated: 2026-04-06T12:19:01Z
- Model: afl-disp-20260406-121832
- Sample count: 100
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.0%, brier 0.26704, logloss 0.731896, clv+ 26.0%

## Confidence Buckets
- high_0.65_plus: n=39, hit=51.28%
- low: n=29, hit=62.07%
- mid_0.57_0.65: n=32, hit=53.12%

## Edge Buckets
- edge_5_8: n=14, hit=50.0%
- edge_8_plus: n=64, hit=53.12%
- edge_under_5: n=22, hit=63.64%

## Top Loss Types
- Under->Over: 29
- Over->Under: 16
