# AFL Disposals Model Card

- Generated: 2026-06-05T18:41:22Z
- Model: afl-disp-20260605-183620
- Sample count: 1442
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.37%, brier 0.245968, logloss 0.684824, clv+ 23.51%

## Confidence Buckets
- high_0.65_plus: n=7, hit=85.71%
- low: n=1257, hit=52.98%
- mid_0.57_0.65: n=178, hit=62.92%

## Edge Buckets
- edge_5_8: n=237, hit=51.05%
- edge_8_plus: n=208, hit=64.9%
- edge_under_5: n=997, hit=52.96%

## Top Loss Types
- Under->Over: 489
- Over->Under: 169
