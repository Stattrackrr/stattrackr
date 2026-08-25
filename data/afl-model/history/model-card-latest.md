# AFL Disposals Model Card

- Generated: 2026-08-25T11:24:43Z
- Model: afl-disp-20260825-112350
- Sample count: 428
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.17%, brier 0.279612, logloss 0.803572, clv+ 13.08%

## Confidence Buckets
- high_0.65_plus: n=151, hit=51.66%
- low: n=146, hit=50.68%
- mid_0.57_0.65: n=131, hit=51.14%

## Edge Buckets
- edge_5_8: n=66, hit=48.48%
- edge_8_plus: n=260, hit=51.92%
- edge_under_5: n=102, hit=50.98%

## Top Loss Types
- Under->Over: 152
- Over->Under: 57
