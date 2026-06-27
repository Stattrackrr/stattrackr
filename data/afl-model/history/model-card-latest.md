# AFL Disposals Model Card

- Generated: 2026-06-27T17:57:30Z
- Model: afl-disp-20260627-175256
- Sample count: 1569
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.73%, brier 0.262643, logloss 0.735263, clv+ 21.16%

## Confidence Buckets
- high_0.65_plus: n=513, hit=55.17%
- low: n=579, hit=53.2%
- mid_0.57_0.65: n=477, hit=52.83%

## Edge Buckets
- edge_5_8: n=221, hit=54.3%
- edge_8_plus: n=935, hit=53.9%
- edge_under_5: n=413, hit=53.03%

## Top Loss Types
- Under->Over: 494
- Over->Under: 232
