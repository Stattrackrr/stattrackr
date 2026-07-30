# AFL Disposals Model Card

- Generated: 2026-07-30T18:15:51Z
- Model: afl-disp-20260730-181341
- Sample count: 954
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.35%, brier 0.265597, logloss 0.74096, clv+ 16.46%

## Confidence Buckets
- high_0.65_plus: n=283, hit=53.36%
- low: n=365, hit=53.97%
- mid_0.57_0.65: n=306, hit=52.61%

## Edge Buckets
- edge_5_8: n=147, hit=50.34%
- edge_8_plus: n=546, hit=52.93%
- edge_under_5: n=261, hit=55.94%

## Top Loss Types
- Under->Over: 284
- Over->Under: 161
