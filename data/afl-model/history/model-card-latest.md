# AFL Disposals Model Card

- Generated: 2026-06-29T18:50:29Z
- Model: afl-disp-20260629-184515
- Sample count: 1591
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.48%, brier 0.264564, logloss 0.739049, clv+ 21.62%

## Confidence Buckets
- high_0.65_plus: n=529, hit=55.01%
- low: n=548, hit=50.55%
- mid_0.57_0.65: n=514, hit=51.95%

## Edge Buckets
- edge_5_8: n=216, hit=53.7%
- edge_8_plus: n=969, hit=53.25%
- edge_under_5: n=406, hit=50.0%

## Top Loss Types
- Under->Over: 503
- Over->Under: 253
