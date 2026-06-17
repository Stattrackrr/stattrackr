# AFL Disposals Model Card

- Generated: 2026-06-17T14:29:01Z
- Model: afl-disp-20260617-142622
- Sample count: 1608
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.47%, brier 0.245205, logloss 0.682905, clv+ 23.57%

## Confidence Buckets
- high_0.65_plus: n=77, hit=71.43%
- low: n=1429, hit=54.16%
- mid_0.57_0.65: n=102, hit=61.76%

## Edge Buckets
- edge_5_8: n=858, hit=53.61%
- edge_8_plus: n=256, hit=64.06%
- edge_under_5: n=494, hit=54.25%

## Top Loss Types
- Under->Over: 527
- Over->Under: 189
