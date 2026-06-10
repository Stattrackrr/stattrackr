# AFL Disposals Model Card

- Generated: 2026-06-10T14:24:05Z
- Model: afl-disp-20260610-142143
- Sample count: 1537
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.33%, brier 0.248487, logloss 0.698242, clv+ 25.18%

## Confidence Buckets
- high_0.65_plus: n=30, hit=60.0%
- low: n=1347, hit=53.53%
- mid_0.57_0.65: n=160, hit=60.0%

## Edge Buckets
- edge_5_8: n=337, hit=51.04%
- edge_8_plus: n=195, hit=60.0%
- edge_under_5: n=1005, hit=54.33%

## Top Loss Types
- Under->Over: 640
- Over->Under: 62
