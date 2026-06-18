# AFL Disposals Model Card

- Generated: 2026-06-18T14:13:35Z
- Model: afl-disp-20260618-140918
- Sample count: 1619
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.05%, brier 0.250106, logloss 0.735946, clv+ 23.9%

## Confidence Buckets
- high_0.65_plus: n=35, hit=60.0%
- low: n=1411, hit=53.3%
- mid_0.57_0.65: n=173, hit=58.96%

## Edge Buckets
- edge_5_8: n=291, hit=52.58%
- edge_8_plus: n=211, hit=58.77%
- edge_under_5: n=1117, hit=53.54%

## Top Loss Types
- Under->Over: 627
- Over->Under: 117
