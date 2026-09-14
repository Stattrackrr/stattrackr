# AFL Disposals Model Card

- Generated: 2026-09-14T16:48:45Z
- Model: afl-disp-20260914-164744
- Sample count: 145
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 51.03%, brier 0.293406, logloss 0.809852, clv+ 15.17%

## Confidence Buckets
- high_0.65_plus: n=57, hit=43.86%
- low: n=46, hit=52.17%
- mid_0.57_0.65: n=42, hit=59.52%

## Edge Buckets
- edge_5_8: n=21, hit=52.38%
- edge_8_plus: n=91, hit=49.45%
- edge_under_5: n=33, hit=54.55%

## Top Loss Types
- Under->Over: 52
- Over->Under: 19
