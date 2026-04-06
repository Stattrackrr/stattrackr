# AFL Disposals Model Card

- Generated: 2026-04-06T14:05:15Z
- Model: afl-disp-20260406-140452
- Sample count: 100
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 56.0%, brier 0.261046, logloss 0.719409, clv+ 24.0%

## Confidence Buckets
- high_0.65_plus: n=38, hit=52.63%
- low: n=27, hit=62.96%
- mid_0.57_0.65: n=35, hit=54.29%

## Edge Buckets
- edge_5_8: n=6, hit=50.0%
- edge_8_plus: n=70, hit=54.29%
- edge_under_5: n=24, hit=62.5%

## Top Loss Types
- Under->Over: 30
- Over->Under: 14
