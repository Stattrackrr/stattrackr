# AFL Disposals Model Card

- Generated: 2026-08-20T11:25:22Z
- Model: afl-disp-20260820-112309
- Sample count: 594
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.84%, brier 0.278005, logloss 0.787806, clv+ 15.99%

## Confidence Buckets
- high_0.65_plus: n=206, hit=52.43%
- low: n=204, hit=50.0%
- mid_0.57_0.65: n=184, hit=50.0%

## Edge Buckets
- edge_5_8: n=89, hit=53.93%
- edge_8_plus: n=357, hit=50.98%
- edge_under_5: n=148, hit=48.65%

## Top Loss Types
- Under->Over: 194
- Over->Under: 98
