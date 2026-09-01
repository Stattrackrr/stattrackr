# AFL Disposals Model Card

- Generated: 2026-09-01T15:25:40Z
- Model: afl-disp-20260901-152428
- Sample count: 325
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 48.62%, brier 0.286707, logloss 0.809299, clv+ 12.31%

## Confidence Buckets
- high_0.65_plus: n=118, hit=49.15%
- low: n=106, hit=46.23%
- mid_0.57_0.65: n=101, hit=50.5%

## Edge Buckets
- edge_5_8: n=47, hit=46.81%
- edge_8_plus: n=202, hit=49.5%
- edge_under_5: n=76, hit=47.37%

## Top Loss Types
- Under->Over: 124
- Over->Under: 43
