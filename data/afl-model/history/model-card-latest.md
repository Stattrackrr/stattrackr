# AFL Disposals Model Card

- Generated: 2026-06-01T21:03:13Z
- Model: afl-disp-20260601-205836
- Sample count: 1399
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.54%, brier 0.245865, logloss 0.684687, clv+ 23.73%

## Confidence Buckets
- high_0.65_plus: n=160, hit=64.38%
- low: n=1217, hit=54.4%
- mid_0.57_0.65: n=22, hit=54.55%

## Edge Buckets
- edge_5_8: n=238, hit=50.0%
- edge_8_plus: n=184, hit=63.04%
- edge_under_5: n=977, hit=55.48%

## Top Loss Types
- Under->Over: 485
- Over->Under: 137
