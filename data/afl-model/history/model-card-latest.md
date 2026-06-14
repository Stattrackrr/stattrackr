# AFL Disposals Model Card

- Generated: 2026-06-14T13:03:00Z
- Model: afl-disp-20260614-130034
- Sample count: 1625
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.15%, brier 0.249917, logloss 0.7354, clv+ 24.18%

## Confidence Buckets
- high_0.65_plus: n=36, hit=61.11%
- low: n=1433, hit=53.52%
- mid_0.57_0.65: n=156, hit=58.33%

## Edge Buckets
- edge_5_8: n=298, hit=54.03%
- edge_8_plus: n=207, hit=57.97%
- edge_under_5: n=1120, hit=53.48%

## Top Loss Types
- Under->Over: 629
- Over->Under: 116
