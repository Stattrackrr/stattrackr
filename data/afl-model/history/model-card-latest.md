# AFL Disposals Model Card

- Generated: 2026-05-06T12:28:48Z
- Model: afl-disp-20260506-122738
- Sample count: 742
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.93%, brier 0.241586, logloss 0.675727, clv+ 28.57%

## Confidence Buckets
- high_0.65_plus: n=102, hit=69.61%
- low: n=613, hit=53.02%
- mid_0.57_0.65: n=27, hit=70.37%

## Edge Buckets
- edge_5_8: n=246, hit=52.85%
- edge_8_plus: n=159, hit=69.18%
- edge_under_5: n=337, hit=51.93%

## Top Loss Types
- Under->Over: 315
- Over->Under: 12
