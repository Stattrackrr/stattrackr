# AFL Disposals Model Card

- Generated: 2026-07-05T12:17:32Z
- Model: afl-disp-20260705-121637
- Sample count: 1444
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 52.56%, brier 0.273226, logloss 0.766735, clv+ 20.29%

## Confidence Buckets
- high_0.65_plus: n=634, hit=53.31%
- low: n=401, hit=49.63%
- mid_0.57_0.65: n=409, hit=54.28%

## Edge Buckets
- edge_5_8: n=180, hit=45.56%
- edge_8_plus: n=973, hit=54.27%
- edge_under_5: n=291, hit=51.2%

## Top Loss Types
- Under->Over: 524
- Over->Under: 161
