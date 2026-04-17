# AFL Disposals Model Card

- Generated: 2026-04-17T11:55:45Z
- Model: afl-disp-20260417-115034
- Sample count: 240
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 59.58%, brier 0.2222, logloss 0.628812, clv+ 29.17%

## Confidence Buckets
- high_0.65_plus: n=67, hit=79.1%
- low: n=162, hit=51.85%
- mid_0.57_0.65: n=11, hit=54.55%

## Edge Buckets
- edge_5_8: n=21, hit=47.62%
- edge_8_plus: n=78, hit=75.64%
- edge_under_5: n=141, hit=52.48%

## Top Loss Types
- Under->Over: 92
- Over->Under: 5
