# AFL Disposals Model Card

- Generated: 2026-08-03T13:41:12Z
- Model: afl-disp-20260803-133941
- Sample count: 890
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.15%, brier 0.265422, logloss 0.744702, clv+ 14.38%

## Confidence Buckets
- high_0.65_plus: n=309, hit=56.31%
- low: n=313, hit=49.52%
- mid_0.57_0.65: n=268, hit=53.73%

## Edge Buckets
- edge_5_8: n=147, hit=51.7%
- edge_8_plus: n=533, hit=55.16%
- edge_under_5: n=210, hit=49.05%

## Top Loss Types
- Under->Over: 292
- Over->Under: 125
