# AFL Disposals Model Card

- Generated: 2026-08-14T11:43:54Z
- Model: afl-disp-20260814-114237
- Sample count: 598
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.33%, brier 0.27848, logloss 0.789618, clv+ 16.56%

## Confidence Buckets
- high_0.65_plus: n=211, hit=51.66%
- low: n=203, hit=49.75%
- mid_0.57_0.65: n=184, hit=49.46%

## Edge Buckets
- edge_5_8: n=88, hit=51.14%
- edge_8_plus: n=362, hit=51.38%
- edge_under_5: n=148, hit=47.3%

## Top Loss Types
- Under->Over: 198
- Over->Under: 99
