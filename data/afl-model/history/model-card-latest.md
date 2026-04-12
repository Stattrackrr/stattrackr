# AFL Disposals Model Card

- Generated: 2026-04-12T17:21:30Z
- Model: afl-disp-20260412-172029
- Sample count: 225
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 59.56%, brier 0.234279, logloss 0.658906, clv+ 31.11%

## Confidence Buckets
- high_0.65_plus: n=29, hit=79.31%
- low: n=73, hit=50.68%
- mid_0.57_0.65: n=123, hit=60.16%

## Edge Buckets
- edge_5_8: n=63, hit=53.97%
- edge_8_plus: n=156, hit=62.18%
- edge_under_5: n=6, hit=50.0%

## Top Loss Types
- Under->Over: 88
- Over->Under: 3
