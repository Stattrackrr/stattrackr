# AFL Disposals Model Card

- Generated: 2026-05-01T12:02:51Z
- Model: afl-disp-20260501-115737
- Sample count: 575
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 56.87%, brier 0.24288, logloss 0.678085, clv+ 30.09%

## Confidence Buckets
- high_0.65_plus: n=8, hit=75.0%
- low: n=382, hit=53.66%
- mid_0.57_0.65: n=185, hit=62.7%

## Edge Buckets
- edge_5_8: n=71, hit=53.52%
- edge_8_plus: n=200, hit=63.0%
- edge_under_5: n=304, hit=53.62%

## Top Loss Types
- Over->Under: 142
- Under->Over: 106
