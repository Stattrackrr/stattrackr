# AFL Disposals Model Card

- Generated: 2026-08-28T01:22:15Z
- Model: afl-disp-20260828-012029
- Sample count: 428
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 51.87%, brier 0.270533, logloss 0.759842, clv+ 14.72%

## Confidence Buckets
- high_0.65_plus: n=132, hit=53.79%
- low: n=157, hit=52.23%
- mid_0.57_0.65: n=139, hit=49.64%

## Edge Buckets
- edge_5_8: n=70, hit=51.43%
- edge_8_plus: n=251, hit=51.79%
- edge_under_5: n=107, hit=52.34%

## Top Loss Types
- Under->Over: 146
- Over->Under: 60
